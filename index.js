const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Redis } = require("@upstash/redis");
const Busboy = require("busboy");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid"); // <--- ADD THIS LINE
const {
  normalizeFilename,
  findStudentByName,
  findSimilarFriendGrp,
} = require("./helpers");
const { extractTableData } = require("./azureOCR");
require("dotenv").config();
const app = express();
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-secret"],
    maxAge: 86400,
  }),
);
app.use(express.json());
const port = process.env.PORT || 8080;
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
app.use((req, res, next) => {
  if (req.headers["x-api-secret"] != process.env.API_SECRET) {
    return res.status(401).send("Unauthorized");
  }
  next();
});
app.get("/", async (req, res) => {
  const jobId = req.query.job_id;
  const fileHash = req.query.file_hash;
  const studentName = req.query.student_name;
  const checkForFile = req.query.check_for_file;
  if (checkForFile && studentName && fileHash) {
    const checkFileIsProcessing = await redis.get(`file_name:${fileHash}`);
    console.log(
      "im the result of checkFile is Processing : ",
      checkFileIsProcessing,
    );

    if (checkFileIsProcessing != null) {
      if (checkFileIsProcessing) {
        const cacheKey = `pdf:hash:${fileHash}`;
        const data = await redis.get(cacheKey);
        if (data != null) {
          const result = findStudentByName(data, studentName);
          return res
            .status(200)
            .json({ source: "cache", status: "found", data: result });
        } else {
          return res.status(200).json({ source: "cache", status: "not found" });
        }
      }
      return res
        .status(200)
        .json({ source: "cache", status: checkFileIsProcessing });
    } else {
      return res.status(200).json({
        source: "cache",
        status: "missing",
        message: "no file with this name found !",
      });
    }
  }
  if (jobId) {
    const jobData = await redis.get(`job:${jobId}`);
    if (!jobData) return res.json({ status: "processing" });
    return res.json({ status: "done", data: jobData });
  }
  if (!studentName || !fileHash) {
    return res
      .status(400)
      .json({ error: "Student Name and file hash are required" });
  }
  const cacheKey = `pdf:hash:${fileHash}`;
  try {
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      const result = findStudentByName(cachedData, studentName);
      console.log(
        `Cache was hit by ! ${result?.match?.name} || class : ${result?.match?.class} `,
      );
      // FIX: Ensure consistency in response structure
      return res
        .status(200)
        .json({ source: "cache", status: "found", data: result });
    } else {
      const checkFileIsProcessing = await redis.get(`file_name:${fileHash}`);
      if (checkFileIsProcessing != null) {
        return res.status(200).json({
          source: "same_file_is_processing",
          status: checkFileIsProcessing,
        });
      }
      return res.status(200).json({ source: "cache", status: "missing" });
    }
  } catch (err) {
    return res.status(500).json({ error: "Cache check failed" });
  }
});
//
app.get("/similar-firend", async (req, res) => {
  const file_hash = req.query.file_hash;
  const student_name = req.query.student_name;
  const grp_name = req.query.grp_name;
  const seat_number = req.query.seat_number;
  if (!file_hash || !student_name || !grp_name || !seat_number) {
    return res.status(400).json({ error: "Missing required parameters" });
  }
  const data = await redis.get(`pdf:hash:${file_hash}`);
  if (!data) {
    return res.status(404).json({ error: "File not found" });
  }
  let target_student = findStudentByName(data, student_name);

  if (!target_student) {
    return res.status(400).json({ error: "Student not found in the file" });
  }
  let similar = findSimilarFriendGrp(
    target_student.student_index,
    data,
    seat_number,
    grp_name,
  );
  console.log(
    `Similar Friend was hit by ${student_name} || class : ${grp_name} `,
  );

  return res.status(200).json(similar);
});
app.post("/", (req, res) => {
  if (
    !req.headers["content-type"] ||
    !req.headers["content-type"].includes("multipart/form-data")
  ) {
    return res
      .status(400)
      .json({ error: "Missing Content-Type. Are you sending a file?" });
  }
  const busboy = Busboy({
    headers: req.headers,
    limits: { fileSize: 5 * 1024 * 1024 },
  });
  let fileBuffer = null;
  let filename = null;
  let studentName = null;
  let fileisToBig = false;
  busboy.on("file", (fieldname, file, info) => {
    filename = normalizeFilename(info.filename);
    const buffers = [];
    file.on("limit", () => {
      console.log(`File ${fieldname} exceeds size limit!`);
      fileisToBig = true;
      file.resume();
    });
    file.on("data", (data) => {
      if (!fileisToBig) {
        buffers.push(data);
      }
    });
    file.on("end", () => {
      if (file.truncated) {
        fileisToBig = true;
      }
      if (!fileisToBig) {
        fileBuffer = Buffer.concat(buffers);
      }
    });
  });
  busboy.on("field", (fieldname, value) => {
    if (fieldname === "student_name") studentName = value.trim();
  });
  busboy.on("finish", async () => {
    if (fileisToBig) {
      return res.status(413).json({ error: "File is too large! Max 5MB" });
    }
    if (!fileBuffer) return res.status(400).json({ error: "No file uploaded" });
    // 1. Generate ID & Reply IMMEDIATELY
    const fileHash = crypto
      .createHash("sha256")
      .update(fileBuffer)
      .digest("hex");
    const jobId = uuidv4();
    await redis.set(`file_name:${fileHash}`, false, { ex: 300 });
    res.status(200).json({ status: "processing", job_id: jobId });
    // 2. Start Background Work
    (async () => {
      try {
        console.log(`[Background] Processing: ${filename} (Job: ${jobId})`);

        if (!studentName) {
          console.log("Error: No student name");
          // Save error to Redis so frontend polling sees it
          await redis.set(
            `job:${jobId}`,
            { error: "No student name provided" },
            { ex: 300 },
          );
          return;
        }

        // A. Check Cache inside background (Just in case)
        if (filename || fileHash) {
          const cached = await redis.get(`pdf:hash:${fileHash}`);
          if (cached) {
            console.log("[Background] Found in cache immediately.");
            const result = findStudentByName(cached, studentName);
            // SAVE TO REDIS (Frontend will pick this up on next poll)
            await redis.set(
              `job:${jobId}`,
              { ...result, source: "cache" },
              { ex: 300 },
            );
            await redis.set(`file_name:${fileHash}`, true, { ex: 300 });
            return; // Stop here, don't call Gemini
          }
        }
        let parsedData;
        let isAzure = true;
        try {
          console.log("Calling Azure...");
          const startTime = Date.now();
          const tableData = await extractTableData(fileBuffer);
          parsedData = tableData;
          const duration = (Date.now() - startTime) / 1000;
          console.log(`✅ Azure finished in ${duration}s`);
        } catch (err) {
          console.error(err);
          console.log("Calling Gemini...");
          isAzure = false;
          const startTime = Date.now();
          const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
          const prompt = `
            Analyze this PDF page. extract all students.
            Return a strict JSON ARRAY of objects.
            Use EXACTLY these lowercase keys:
            - "numero"
            - "name"
            - "class"
            Do not include Markdown formatting. Just raw JSON.
          `;
          const result = await model.generateContent([
            prompt,
            {
              inlineData: {
                data: fileBuffer.toString("base64"),
                mimeType: "application/pdf",
              },
            },
          ]);
          const duration = (Date.now() - startTime) / 1000;
          console.log(`✅ Gemini finished in ${duration}s`);

          const text = result.response.text();
          const cleanJson = text.replace(/```json|```/g, "").trim();
          parsedData = JSON.parse(cleanJson);
        }

        // C. Save Results
        // 1. Save full list to main cache (for future users)
        if (fileHash) {
          await redis.set(`pdf:hash:${fileHash}`, parsedData, { ex: 86400 });
          await redis.set(`file_name:${fileHash}`, true, { ex: 300 });
        }
        const studentResult = findStudentByName(parsedData, studentName);
        await redis.set(
          `job:${jobId}`,
          { ...studentResult, source: isAzure ? "azure" : "gemini" },
          { ex: 300 },
        );

        console.log(`[Background] Job ${jobId} Completed.`);
        console.log(
          `[Background] Job was send to ${studentResult?.match?.name} || class : ${studentResult?.match?.class}`,
        );
      } catch (err) {
        console.error(`[Background] Job ${jobId} Failed:`, err);
        await redis.del(`file_name:${fileHash}`);
        await redis.set(
          `job:${jobId}`,
          { error: "Processing failed" },
          { ex: 300 },
        );
      }
    })();
  });
  req.pipe(busboy);
});
app.post("/vote", async (req, res) => {
  console.log(req.body);

  const { fileHash, vote } = req.body;

  if (!fileHash || !["cooked", "inchallah", "crush"].includes(vote)) {
    return res.status(400).json({ error: "Invalid vote" });
  }
  const pdfExists = await redis.exists(`pdf:hash:${fileHash}`);
  if (!pdfExists) {
    console.warn(`⚠️ Fake vote attempt on non-existent hash: ${fileHash}`);
    return res.status(404).json({ error: "Exam file not found. Cannot vote." });
  }
  const key = `poll:${fileHash}`;

  try {
    await redis.hincrby(key, vote, 1);
    const stats = await redis.hgetall(key);
    let total =
      parseInt(stats.cooked || 0) +
      parseInt(stats.inchallah || 0) +
      parseInt(stats.crush || 0);
    if (total == 1) {
      await redis.expire(key, 86400);
    }
    res.json({
      cooked: parseInt(stats.cooked || 0),
      inchallah: parseInt(stats.inchallah || 0),
      crush: parseInt(stats.crush || 0),
      total: total,
    });
  } catch (error) {
    console.error("Redis Error:", error);
    res.status(500).json({ error: "Failed to count vote" });
  }
});

app.get("/vote-stats", async (req, res) => {
  const { fileHash } = req.query;
  const stats = await redis.hgetall(`poll:${fileHash}`);
  if(stats == null){
    return res.status(404).json({ error: "Exam file not found. Cannot vote." });
  }
  res.json({
    cooked: parseInt(stats.cooked || 0),
    inchallah: parseInt(stats.inchallah || 0),
    crush: parseInt(stats.crush || 0),
    total:
      parseInt(stats.cooked || 0) +
      parseInt(stats.inchallah || 0) +
      parseInt(stats.crush || 0),
  });
});
app.listen(port, () => {
  console.log(`EMSI Locator Backend running on port ${port}`);
});
