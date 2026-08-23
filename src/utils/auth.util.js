const crypto = require("crypto");
const resend = require("../config/resend.config");

const generateOtp = () => {
  return crypto.randomInt(100000, 999999).toString();
};

const sendAuthEmail = async ({ email, name, otpCode, type }) => {
  try {
    let subject = "";
    let html = "";

    if (type === "REGISTER") {
      subject = "Welcome to Tallero Auto - Verify Your Account";
      html = `<p>Hi ${name},</p>
              <p>Welcome to Tallero Auto! Your verification OTP code is: <strong>${otpCode}</strong></p>
              <p>This code is valid for 10 minutes.</p>`;
    } else if (type === "FORGOT_PASSWORD") {
      subject = "Tallero Auto - Password Reset OTP";
      html = `<p>Hi ${name},</p>
              <p>You requested a password reset. Your OTP code is: <strong>${otpCode}</strong></p>
              <p>This code is valid for 10 minutes. If you didn't request this, please ignore this email.</p>`;
    }

    await resend.emails.send({
      from: "Tallero <noreply@resend.dev>",
      to: email,
      subject,
      html,
    });
  } catch (error) {
    console.error("Failed to send auth email via Resend:", error.message);
  }
};

module.exports = {
  generateOtp,
  sendAuthEmail,
};
