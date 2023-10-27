const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const User = require('../../models/User');

exports.logout = async (req, res) => {
  const result = await User.findOneAndUpdate(
    { _id: req.body._id },
    { isLoggedIn: false },
    {
      new: true,
    }
  ).exec();

  res.status(200).json({
    code: 200,
    message: 'Logged out!',
    data: {
      isLoggedIn: false,
    },
  });
};

exports.signup = async (req, res) => {
  console.log(req.body);

  try {
    const user = await User.findOne({ email: req.body.email }).exec();
    if (user) {
      res.status(200).json({
        code: 500,
        message: 'This user is already registered',
        data: {},
      });
      return;
    }
    const salt = await bcrypt.genSalt();
    const passwordHash = await bcrypt.hash(req.body.password, salt);
    let newUser = new User({
      username: req.body.username,
      email: req.body.email,
      password: passwordHash,
    });
    newUser = await newUser.save();
    if (!newUser) {
      res.status(200).json({
        code: 500,
        message: 'Failed to create new one user',
        data: {},
      });
      return;
    }

    res.status(200).json({
      code: 200,
      message: 'You are registered successfully',
      data: {
        username: newUser.username,
        email: newUser.email,
      },
    });
  } catch (err) {
    console.log('signup');
    console.log(err);
    if (err) {
      res.status(200).json({
        code: 500,
        message: err,
        data: {},
      });
      return;
    }
  }
};

exports.login = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email })
      // .populate('roles', '-__v')
      .exec();
    if (!user) {
      return res
        .status(200)
        .json({ code: 404, message: 'User Not found.', data: {} });
    }
    let passwordIsValid = bcrypt.compareSync(req.body.password, user.password);

    if (!passwordIsValid) {
      return res.status(200).json({
        code: 404,
        message: 'Invalid Password!',
        data: { token: null },
      });
    }

    const userToken = {
      _id: user._id,
      email: user.email,
      password: user.password,
      // orgId: currentUser.orgInfo[0].orgId,
    };

    let token = jwt.sign(userToken, 'ebeb1a5ada5cf38bfc2b49ed5b3100e0', {
      expiresIn: 86400, // 24 hours
    });

    if (!token) {
      return res
        .status(200)
        .json({ code: 200, message: 'Invalid to generate token!', data: {} });
    }

    let profile = {
      ...user.toObject(),
    };
    delete profile.password;

    res.status(200).json({
      code: 200,
      message: 'logged in successfully',
      data: {
        token: token,
        profile: profile,
      },
    });
  } catch (err) {
    console.log('login');
    if (err) {
      res.status(200).json({
        code: 500,
        message: err,
        data: {},
      });
      return;
    }
  }
};
