const { GoogleGenerativeAI } = require("@google/generative-ai");
const prisma = require("../config/prisma.config");
const AppError = require("../utils/appError.util");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIzaSy_dummy_key");

const askChatbot = async (req, res, next) => {
  try {
    const { message } = req.body;

    if (!message) {
      return next(new AppError("Message is required.", 400));
    }

    const services = await prisma.service.findMany({
      select: { name: true, price: true, estimatedTime: true },
    });

    let context = "Anda adalah asisten AI 'Tallero Auto', bengkel servis kendaraan premium.\n";
    context += "Gunakan informasi layanan berikut:\n";
    services.forEach((s) => {
      context += `- ${s.name}: Harga Rp${s.price.toLocaleString("id-ID")}, estimasi ${s.estimatedTime} menit.\n`;
    });
    
    context += "\nTugas Anda: Berikan diagnosa keluhan, berikan saran awal yang edukatif, dan sarankan booking servis. Jawab dengan ramah dalam Bahasa Indonesia.";

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: context }] },
        { role: "model", parts: [{ text: "Halo! Saya adalah asisten AI Tallero Auto. Ada yang bisa saya bantu terkait kendaraan Anda?" }] },
      ],
      generationConfig: { maxOutputTokens: 600 },
    });

    const result = await chat.sendMessage(message);
    const response = await result.response;
    const replyText = response.text();

    res.status(200).json({
      status: "success",
      data: { reply: replyText },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  askChatbot,
};
