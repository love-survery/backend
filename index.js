const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const { Parser } = require("json2csv");
const axios = require("axios");

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// MySQL 연결 설정
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

// 설문 제출 API
app.post("/submit", async (req, res) => {
  const { token, answers } = req.body;
  try {
    const { sub: userId, email } = await verifyGoogleToken(token);
    const [rows] = await db.execute(
      "SELECT * FROM submissions WHERE user_id = ?",
      [userId]
    );
    if (rows.length > 0) {
      return res.status(409).json({ message: "이미 설문을 제출했습니다." });
    }

    await db.execute(
      "INSERT INTO submissions (user_id, email, data, submitted_at) VALUES (?, ?, ?, NOW())",
      [userId, email, JSON.stringify(answers)]
    );

    res.json({ message: "제출 완료!" });
  } catch (err) {
    console.error(err);
    res.status(401).json({ message: "제출 실패", error: err.message });
  }
});

// 설문 데이터 CSV로 다운로드 API
// 설문 데이터 CSV로 다운로드 API (관리자만)

// Google 토큰 검증 함수
async function verifyGoogleToken(idToken) {
  const res = await axios.get(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
  );

  console.log("🧪 Google 응답:", res.data);

  if (res.data.aud !== process.env.GOOGLE_CLIENT_ID) {
    throw new Error("Invalid Token");
  }

  return { email: res.data.email, sub: res.data.sub };
}

// 관리자만 설문 CSV 다운로드 API
app.get("/export", async (req, res) => {
  const token = req.headers.authorization?.split("Bearer ")[1];

  if (!token) {
    console.log("❌ 토큰 없음");
    return res.status(401).json({ message: "토큰이 없습니다." });
  }

  try {
    const { email } = await verifyGoogleToken(token);

    console.log("🟡 받은 이메일:", email);
    console.log("🟡 관리자 이메일:", process.env.ADMIN_EMAIL);

    if (email !== process.env.ADMIN_EMAIL) {
      console.log("❌ 관리자 이메일 불일치");
      return res.status(403).json({ message: "관리자만 접근할 수 있습니다." });
    }

    const [rows] = await db.execute("SELECT * FROM submissions");

    const data = rows.map((row) => {
      let parsedData;
      try {
        // 문자열이면 파싱하고, 이미 객체면 그대로 사용
        parsedData =
          typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      } catch (e) {
        console.error("❌ JSON 파싱 실패:", e);
        parsedData = {}; // 파싱 실패 시 빈 객체로 대체
      }

      return {
        email: row.email,
        submittedAt: row.submitted_at,
        ...parsedData,
      };
    });

    const parser = new Parser();
    const csv = parser.parse(data);

    res.header("Content-Type", "text/csv");
    res.attachment("submissions.csv");
    res.send(csv);
  } catch (err) {
    console.error("❌ 토큰 검증 실패 또는 내부 오류:", err.message);
    res.status(401).json({ message: "토큰 검증 실패", error: err.message });
  }
});

// 서버 실행
app.listen(process.env.PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${process.env.PORT}`);
});
