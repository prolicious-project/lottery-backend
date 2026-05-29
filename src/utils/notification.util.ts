import nodemailer from "nodemailer";

// Create reusable transporter object using SMTP transport
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendEmailNotification = async (to: string, subject: string, html: string) => {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn("SMTP credentials not configured. Skipping email notification.");
      return;
    }
    const info = await transporter.sendMail({
      from: `"Lottery Admin" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log("Message sent: %s", info.messageId);
  } catch (error) {
    console.error("Error sending email notification:", error);
  }
};

export const sendSMSNotification = async (to: string, body: string) => {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromPhone) {
      console.warn("Twilio credentials not configured. Skipping SMS notification.");
      return;
    }

    // Dynamic import to avoid crash if twilio isn't installed
    const twilio = (await import("twilio")).default;
    const client = twilio(accountSid, authToken);

    const message = await client.messages.create({
      body,
      from: fromPhone,
      to,
    });
    console.log("SMS sent: %s", message.sid);
  } catch (error) {
    console.error("Error sending SMS notification:", error);
  }
};
