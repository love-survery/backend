const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const { Parser } = require("json2csv");
const axios = require("axios");

// 환경 변수를 상수로 정의
const MYSQL_HOST = process.env.MYSQL_HOST || "localhost";
const MYSQL_PORT = process.env.MYSQL_PORT || 3306;
const MYSQL_USER = process.env.MYSQL_USER || "root";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "0000";
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || "love_survey";
const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  "940848428759-0iuk6hshn82nhrpc4elnfsf8t97ijqaa.apps.googleusercontent.com";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "boss20088002@gmail.com";
const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(bodyParser.json());

// MySQL 연결 설정
const db = mysql.createPool({
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
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

  if (res.data.aud !== GOOGLE_CLIENT_ID) {
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
    console.log("🟡 관리자 이메일:", ADMIN_EMAIL);

    if (email !== ADMIN_EMAIL) {
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
app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
