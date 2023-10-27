const mongoose = require('mongoose');
const Schema = mongoose.Schema;
mongoose.Promise = global.Promise;
const dotenv = require('dotenv');
dotenv.config();
const jwt = require('jsonwebtoken');

const userSchema = new Schema({
  // removed: {
  //   type: Boolean,
  //   default: false,
  // },
  // enabled: {
  //   type: Boolean,
  //   default: true,
  // },
  email: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true,
    required: true,
  },
  password: {
    type: String,
  },
  // firstname: { type: String, required: true },
  // lastname: { type: String, required: true },
  username: { type: String, required: true },
  avatar: {
    type: String,
    trim: true,
    default: '',
  },
  chatbot: [
    {
      indexName: {
        type: String,
      },
      name: {
        type: String,
      },
    },
  ],
  createdAt: {
    type: Date,
  },
  updatedAt: {
    type: Date,
  },
  isLoggedIn: {
    type: Boolean,
  },
});

const User = mongoose.model('User', userSchema);
module.exports = User;
