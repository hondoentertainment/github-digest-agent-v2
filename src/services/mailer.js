import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

export async function sendDigestEmail(htmlContent) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: process.env.EMAIL_TO,
    subject: `📊 GitHub Digest — ${today}`,
    html: htmlContent,
  });

  console.log(`✉️  Digest sent: ${info.messageId}`);
  return info;
}
