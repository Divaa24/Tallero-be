const jwt = require("jsonwebtoken");

const generateToken = (payload, expiresIn = "1d") => {
  return jwt.sign(payload, process.env.JWT_SECRET || "rahasia_tallero_123", {
    expiresIn,
  });
};

module.exports = {
  generateToken,
};
