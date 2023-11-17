const { Pinecone } = require("@pinecone-database/pinecone");
const xlsx = require("xlsx");
const { PDFLoader } = require("langchain/document_loaders/fs/pdf");
const { DocxLoader } = require("langchain/document_loaders/fs/docx");
const { TextLoader } = require("langchain/document_loaders/fs/text");
const { CSVLoader } = require("langchain/document_loaders/fs/csv");

const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { Document } = require("langchain/document");
const { OpenAIEmbeddings } = require("langchain/embeddings/openai");
const { OpenAI } = require("langchain/llms/openai");
const { ChatOpenAI } = require("langchain/chat_models/openai");
const { PromptTemplate } = require("langchain/prompts");
const { AIChatMessage, HumanChatMessage } = require("langchain/schema");
const { CallbackManager } = require("langchain/callbacks");
const Bottleneck = require("bottleneck");

const { LLMChain } = require("langchain/chains");
const openai = require("openai");

const uuidv4 = require("uuid");

require("dotenv").config();
const limiter = new Bottleneck({
  minTime: 50,
});

exports.test = (req, res) => {
  console.log(req.body);
  res.json({ message: "Welcome to Charles March!." });
};

const summarizerTemplate = `Shorten the text in the CONTENT, attempting to answer the INQUIRY You should follow the following rules when generating the summary:
  - The summary will answer the INQUIRY. If it cannot be answered, the summary should be empty, AND NO TEXT SHOULD BE RETURNED IN THE FINAL ANSWER AT ALL.
  - If the CONTENT does not include any information related to INQUIRY, final answer must be empty.
  - The summary should be under 4000 characters but if CONTENT does not include any information related to INQUIRY, final answer must be empty.
  - The summary should be 2000 characters long, but if CONTENT does not include any information related to INQUIRY, final answer must be empty.

  INQUIRY: {inquiry}
  CONTENT: {document}

  Final answer:
  `;

const summarizerDocumentTemplate = `Summarize the text in the CONTENT. You should follow the following rules when generating the summary:
  - Any code found in the CONTENT should ALWAYS be preserved in the summary, unchanged.
  - The summary should be under 4000 characters.
  - The summary should be at least 1500 characters long, if possible.

  CONTENT: {document}

  Final answer:
  `;

const chunkSubstr = (str, size) => {
  const numChunks = Math.ceil(str.length / size);
  const chunks = new Array(numChunks);
  for (let i = 0, o = 0; i < numChunks; ++i, o += size) {
    chunks[i] = str.substr(o, size);
  }
  return chunks;
};

const summarize = async ({ document, inquiry, onSummaryDone }) => {
  const llm = new OpenAI({
    concurrency: 10,
    temperature: 0,
    modelName: "gpt-3.5-turbo",
  });

  const promptTemplate = new PromptTemplate({
    template: inquiry ? summarizerTemplate : summarizerDocumentTemplate,
    inputVariables: inquiry ? ["document", "inquiry"] : ["document"],
  });
  const chain = new LLMChain({
    prompt: promptTemplate,
    llm,
  });

  try {
    const result = await chain.call({
      prompt: promptTemplate,
      document,
      inquiry,
    });
    onSummaryDone && onSummaryDone(result.text);
    return result.text;
  } catch (e) {
    console.log(e);
  }
};

const rateLimitedSummarize = limiter.wrap(summarize);

const summarizeLongDocument = async ({ document, inquiry, onSummaryDone }) => {
  const templateLength = inquiry
    ? summarizerTemplate.length
    : summarizerDocumentTemplate.length;
  try {
    if (document.length + templateLength > 4000) {
      const chunks = chunkSubstr(document, 4000 - templateLength - 1);
      let summarizedChunks = [];
      summarizedChunks = await Promise.all(
        chunks.map(async (chunk) => {
          let result;
          if (inquiry) {
            result = await rateLimitedSummarize({
              document: chunk,
              inquiry,
              onSummaryDone,
            });
          } else {
            result = await rateLimitedSummarize({
              document: chunk,
              onSummaryDone,
            });
          }
          return result;
        })
      );

      const result = summarizedChunks.join("\n");

      if (result.length + templateLength > 4000) {
        return await summarizeLongDocument({
          document: result,
          inquiry,
          onSummaryDone,
        });
      } else {
        return result;
      }
    } else {
      return document;
    }
  } catch (e) {
    throw e;
  }
};

const truncateStringByBytes = (str, bytes) => {
  const enc = new TextEncoder();
  return new TextDecoder("utf-8").decode(enc.encode(str).slice(0, bytes));
};

const sliceIntoChunks = (arr, chunkSize) => {
  return Array.from({ length: Math.ceil(arr.length / chunkSize) }, (_, i) =>
    arr.slice(i * chunkSize, (i + 1) * chunkSize)
  );
};

const getEmbedding = async (doc) => {
  const embedder = new OpenAIEmbeddings({
    modelName: "text-embedding-ada-002",
    openAIApiKey: "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",
  });
  const embedding = await embedder.embedQuery(doc.pageContent);

  return {
    id: uuidv4(),
    values: embedding,
    metadata: {
      chunk: doc.pageContent,
      text: doc.metadata.text,
      url: doc.metadata.url,
    },
  };
};

const rateLimitedGetEmbedding = limiter.wrap(getEmbedding);

async function handleFiles(files, vectorStore) {
  for (const file of files) {
    let loader;
    const ext = file.split(".")[1];
    if (ext === "pdf") {
      loader = new PDFLoader("uploads/" + file, { splitPages: false });
    } else if (ext === "doc" || ext === "docx") {
      loader = new DocxLoader("uploads/" + file);
    } else if (ext === "txt") {
      loader = new TextLoader("uploads/" + file);
    } else if (ext === "csv") {
      loader = new CSVLoader("uploads/" + file);
    } else if (ext === "xls" || ext === "xlsx") {
      vectorStore = await handleXlsxFile(file, vectorStore);
      continue;
    } else {
      continue;
    }
    const docs = await loader.load();
    const output = await splitAndTruncate(docs, file);
    vectorStore = vectorStore.concat(output);
  }
  return vectorStore;
}

async function handleXlsxFile(file, vectorStore) {
  const workbook = xlsx.readFile("uploads/" + file);
  let workbook_sheet = workbook.SheetNames;
  let res = xlsx.utils.sheet_to_json(workbook.Sheets[workbook_sheet[0]]);
  let temp = "";
  for (let i = 0; i < res.length; i++) {
    temp.concat(JSON.stringify(res[i]).replaceAll(",", "\n"));
  }
  const output = await splitAndTruncate([{ pageContent: temp }], file);
  return vectorStore.concat(output);
}

async function splitAndTruncate(docs, url) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 300,
    chunkOverlap: 20,
  });

  const pageContent = docs[0].pageContent;
  // console.log("pageContent: ", pageContent);

  const output = await splitter.splitDocuments([
    new Document({
      pageContent,
      metadata: {
        url,
        text: truncateStringByBytes(pageContent, 36000),
      },
    }),
  ]);
  return output;
}

const jsonToConversation = (json) => {
  const conversation = [];

  for (let i = 0; i < json.length; i++) {
    if (json[i].role === "user") {
      if (i === json.length - 1) {
        continue;
      }
      conversation.push(new HumanChatMessage(json[i].content));
    } else {
      conversation.push(new AIChatMessage(json[i].content));
    }
  }

  return conversation;
};

exports.createChatbot = async (req, res, next) => {
  try {
    const tempFiles = req.body.files;

    console.log("tempFiles: ", tempFiles);
    // console.log('length: ', tempFiles.length);

    let files;
    let vectorStore = [];

    if (tempFiles.length !== 0) {
      files = tempFiles;
      vectorStore = await handleFiles(files, vectorStore);

      // return res.status(200).json({
      //   success: true,
      //   message: "Successfully found all documents",
      //   data: vectorStore,
      // });
    }

    if (vectorStore.length) {
      // let textdata = '';
      // vectorStore.map((vector) => {
      //   textdata = textdata.concat(vector.pageContent);
      // });

      // console.log('textdata: ', textdata.length);
      // if (textdata.length > process.env.LIMITATION_CHARACTERS) {
      //   return res.status(400).json({
      //     message: `You can use only ${process.env.LIMITATION_CHARACTERS} characters for your custom bot.`,
      //   });
      // } else {

      let vectors = [];
      await Promise.all(
        vectorStore.flat().map(async (doc) => {
          const vector = await rateLimitedGetEmbedding(doc);
          vectors.push(vector);
        })
      );
      // return res.status(200).json({
      //   success: true,
      //   message: 'Successfully found all documents',
      //
      // });
      const chunks = sliceIntoChunks(vectors, 10);

      const pinecone = new Pinecone();

      await pinecone.init({
        apiKey: process.env.PINECONE_API_KEY,
        environment: process.env.PINECONE_ENVIRONMENT,
      });

      const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX);
      const namespace = "11bf5b37-e0b8-42e0-8dcf-dc8c4aefc000";

      await Promise.all(
        chunks.map(async (chunk) => {
          await pineconeIndex.upsert({
            upsertRequest: {
              namespace: namespace,
              vectors: chunk,
            },
          });
        })
      );

      res.status(200).json({
        code: 200,
        message: "Chatbot is successfully created",
      });

      // }
    }
  } catch (err) {
    console.log(err);
    return res
      .status(200)
      .json({ code: 500, message: "Internal server error", data: [] });
  }
};

exports.getReply = async (req, res, next) => {
  console.log(req.body.query);
  return res.status(200).json({
    success: true,
    message: "Successfully found all documents",
  });
  const { query } = req.body;
  const namespace = "11bf5b37-e0b8-42e0-8dcf-dc8c4aefc000";
  const language = "English";
  let conversationHistory = [];
  const messages = [];
  conversationHistory = jsonToConversation(messages);

  const pinecone = new Pinecone();

  await pinecone.init({
    environment: process.env.PINECONE_ENVIRONMENT,
    apiKey: process.env.PINECONE_API_KEY,
  });
  const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX);
  const llm = new OpenAI({});

  try {
    const inquiryTemplate = `Given the following user prompt and conversation log, formulate a question that would be the most relevant to provide the user with an answer from a knowledge base.
    You should follow the following rules when generating and answer:
    - Always prioritize the user prompt over the conversation log.
    - Ignore any conversation log that is not directly related to the user prompt.
    - Only attempt to answer if a question was posed.
    - The question should be a single sentence
    - You should remove any punctuation from the question
    - You should remove any words that are not relevant to the question
    - If you are unable to formulate a question, respond with the same USER PROMPT you got.

    USER PROMPT: {userPrompt}

    CONVERSATION LOG: {conversationHistory}

    Final answer:
    `;

    const qaTemplate = `Answer the question based on the context below. You should follow ALL the following rules when generating and answer:
    - There will be a CONVERSATION LOG, CONTEXT, and a QUESTION.
    - The final answer must always be styled using markdown.
    - Your main goal is to point the user to the right source of information based on the CONTEXT you are given.
    - Your secondary goal is to provide the user with an answer that is relevant to the question.
    - Provide the user with a code example that is relevant to the question, if the context contains relevant code examples. Do not make up any code examples on your own.
    - Take into account the entire conversation so far, marked as CONVERSATION LOG, but prioritize the CONTEXT.
    - Based on the CONTEXT, choose the source that is most relevant to the QUESTION.
    - Do not make up any answers if the CONTEXT does not have relevant information.
    - Use bullet points, lists, paragraphs and text styling to present the answer in markdown.
    - The CONTEXT is a set of JSON objects, each includes the field "text" where the content is stored, and "url" where the url of the page is stored.
    - Always include the source at the end of the answer. The format is Source: [SOURCE]. The SOURCE is same as the "url" field of CONTENT. If the format of "url" field website_url then format of SOURCE is same as website_url. If the format of "url" field is the youtube_url then the format of SOURCE is same as youtube_url. If the format of the url "field" is file_name or "Plain Text" then don't provide the SOURCE.
    - Do not mention the CONTEXT or the CONVERSATION LOG in the answer, but use them to generate the answer.
    - ALWAYS prefer the result with the highest "score" value.
    - Ignore any content that is stored in html tables.
    - The answer should only be based on the CONTEXT. Do not use any external sources. Do not generate the response based on the question without clear reference to the context.
    - Summarize the CONTEXT to make it easier to read, but don't omit any information.
    - Don't provide a link if it is not found in the CONTEXT.
    - Please answer in ${language}.

    CONVERSATION LOG: {conversationHistory}

    CONTEXT: {summaries}

    QUESTION: {question}

    URLS: {urls}

    Final Answer: `;

    const inquiryChain = new LLMChain({
      llm,
      prompt: new PromptTemplate({
        template: inquiryTemplate,
        inputVariables: ["userPrompt", "conversationHistory"],
      }),
    });

    const inquiryChainResult = await inquiryChain.call({
      userPrompt: query,
      conversationHistory,
    });

    const inquiry = inquiryChainResult.text;

    console.log("inquiry: ", inquiry);

    const embedder = new OpenAIEmbeddings({
      modelName: "text-embedding-ada-002",
    });

    const embeddings = await embedder.embedQuery(inquiry);
    const queryRequest = {
      vector: embeddings,
      topK: 5,
      namespace: namespace,
      includeMetadata: true,
      // includeMetadata: false,
    };

    const queryResult = await pineconeIndex.query({ queryRequest });
    // console.log("queryResult", queryRequest);

    const matches =
      queryResult.matches?.map((match) => ({
        ...match,
        metadata: match.metadata,
      })) || [];

    const urls =
      matches &&
      Array.from(
        new Set(
          matches.map((match) => {
            const metadata = match.metadata;
            const { url } = metadata;
            return url;
          })
        )
      );

    const docs =
      matches &&
      Array.from(
        matches.reduce((map, match) => {
          const metadata = match.metadata;
          const { text, url } = metadata;
          if (!map.has(url)) {
            map.set(url, text);
          }
          return map;
        }, new Map())
      ).map(([_, text]) => text);
    const promptTemplate = new PromptTemplate({
      template: qaTemplate,
      inputVariables: ["summaries", "question", "conversationHistory", "urls"],
    });

    const chat = new ChatOpenAI({
      verbose: true,
      // temperature: 0.7,
      // topP: topP,
      // frequencyPenalty: frequency,
      // presencePenalty: presence,
      // maxTokens: maxTokens,
      modelName: "gpt-3.5-turbo",
      openAIApiKey: process.env.OPENAI_API_KEY,

      // callbackManager: CallbackManager.fromHandlers({
      //   async handleLLMNewToken(token) {
      //     sendData(token, chatId);
      //   },
      // }),
    });

    const chain = new LLMChain({
      prompt: promptTemplate,
      llm: chat,
    });

    const allDocs = docs.join("\n");

    const summary =
      allDocs.length > 4000
        ? await summarizeLongDocument({ document: allDocs, inquiry })
        : allDocs;

    await chain
      .call({
        summaries: summary,
        question: query,
        conversationHistory,
        urls,
      })
      .then(async (row) => {
        console.log("row", row);
        res.status(200).json({
          success: "Success",
          payload: row.text,
        });
      });
  } catch (error) {
    console.log("error", error);
  } finally {
    sendData("[DONE]");
    res.end();
  }
};
