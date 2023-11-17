const express = require("express");
const router = express.Router();
const controller = require("../controllers/index");

router.post("/test", controller.test);
router.post("/train", controller.createChatbot);
router.post("/reply", controller.getReply);

module.exports = router;
