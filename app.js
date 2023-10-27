var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors());
const db_url = `mongodb+srv://${process.env.MONGO_URL_NAME}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_URL_CLUSTER}/${process.env.MONGO_DATABASE}?retryWrites=true&w=majority`;

console.log(db_url);
mongoose.connect(db_url, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const connection = mongoose.connection;

connection.once('open', () => {
  console.log('Connected to database');
});

// simple route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to bezkoder application.' });
});

app.set('jwt', 'ebeb1a5ada5cf38bfc2b49ed5b3100e0');

// routes
app.use('/', require('./routes'));
// Handle not valid route
app.use('*', (req, res) => {
  res.status(404).json({ status: false, message: 'Endpoint Not Found' });
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
