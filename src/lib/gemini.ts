import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface AnalysisResult {
  faceShape: string;
  justification: string;
  recommendations: {
    style: string;
    score: number;
    description: string;
  }[];
}

export async function analyzeFace(imageBase64: string, hairDetails: { length: string; type: string; thickness: string }): Promise<AnalysisResult> {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Analisis gambar wajah ini untuk barbershop "PAPA N ME".
    Detail rambut pengguna:
    - Panjang: ${hairDetails.length}
    - Tipe: ${hairDetails.type}
    - Ketebalan: ${hairDetails.thickness}

    Berikan:
    1. Bentuk wajah yang terdeteksi (misalnya, Oval, Kotak, Bulat, Hati, Berlian). Gunakan bahasa Indonesia.
    2. Penjelasan singkat AI untuk bentuk wajah ini dalam bahasa Indonesia.
    3. 3-4 rekomendasi gaya rambut yang cocok dengan bentuk wajah dan tipe rambut ini.
    4. Untuk setiap rekomendasi, berikan skor kecocokan (0-100) dan alasan singkat mengapa gaya tersebut cocok dalam bahasa Indonesia.

    Kembalikan hasil dalam format JSON.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: imageBase64.split(",")[1],
          },
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          faceShape: { type: Type.STRING },
          justification: { type: Type.STRING },
          recommendations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                style: { type: Type.STRING },
                score: { type: Type.NUMBER },
                description: { type: Type.STRING },
              },
              required: ["style", "score", "description"],
            },
          },
        },
        required: ["faceShape", "justification", "recommendations"],
      },
    },
  });

  return JSON.parse(response.text || "{}") as AnalysisResult;
}

export async function generateHairstyle(imageBase64: string, style: string, hairDetails: { length: string; type: string; thickness: string }): Promise<string> {
  const model = "gemini-2.5-flash-image";
  const prompt = `Terapkan gaya rambut "${style}" pada wajah orang ini. 
  PENTING: JANGAN mengubah wajah, ekspresi, atau sudut pandang (angle) orang tersebut. Hanya ubah bagian rambutnya saja.
  Rambut harus memiliki panjang ${hairDetails.length}, tipe ${hairDetails.type}, dan ketebalan ${hairDetails.thickness}. 
  Pastikan hasilnya terlihat alami dan profesional untuk barbershop "PAPA N ME". 
  Output harus berupa gambar yang telah diedit yang menunjukkan gaya rambut baru tersebut.`;

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: imageBase64.split(",")[1],
          },
        },
        { text: prompt },
      ],
    },
  });

  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  }
  throw new Error("No image generated");
}
