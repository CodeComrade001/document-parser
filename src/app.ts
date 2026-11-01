import fastify from "fastify";
import cors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import { DocumentRoute } from "./route/document.routes";


export async function createApp() {
  const app = fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
      ],
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          singleLine: false,
          errorLikeObjectKeys: ['err', 'error'],
        },
      },
    },
    bodyLimit: 1_048_576,
    trustProxy: false,
  });

  // ---------- CROSS ORIGIN ----------
  await app.register(cors, {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  });

  // ---------- FILE UPLOAD ----------
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 200 * 1024,
      files: 300,
    },
  });

  // ---------- ROUTES ----------
  await app.register(DocumentRoute, { prefix: "/api/document" });

  // ---------- ERROR HANDLING ----------
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: "URL OR METHOD Not found" });
  });

  app.setErrorHandler((error: any, _req, reply) => {
    reply.code(500).send({
      error: "Internal Server Error",
      details:
        process.env.NODE_ENV === "production"
          ? undefined
          : error?.message,
    });
  });

  return app;
}