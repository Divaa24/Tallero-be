const { GoogleGenerativeAI } = require("@google/generative-ai");
const prisma = require("../config/prisma");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIzaSy_dummy_key");

const handleChat = async (req, res, next) => {
  try {
    const { message } = req.body;

    // Fetch services to provide context to Gemini
    const services = await prisma.service.findMany({
      include: { category: true }
    });
    
    let context = "Anda adalah asisten AI untuk 'Tallero Bengkel'. Berikut adalah daftar layanan yang tersedia:\n";
    services.forEach(s => {
      context += `- ${s.name} (Kategori: ${s.category.name}), Harga: Rp${s.price}, Waktu: ${s.estimatedTime} menit.\n`;
    });
    
    context += "\nJawab pertanyaan pelanggan dengan ramah dan informatif menggunakan bahasa Indonesia. Jangan menjawab hal di luar konteks bengkel atau layanan kami.";

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: context }],
        },
        {
          role: "model",
          parts: [{ text: "Mengerti. Saya siap membantu pelanggan Tallero Bengkel." }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 500,
      },
    });

    const result = await chat.sendMessage(message);
    const response = await result.response;
    const text = response.text();

    res.json({
      status: "success",
      data: {
        reply: text
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  handleChat
};
