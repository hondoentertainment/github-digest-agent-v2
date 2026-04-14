/**
 * Vercel entry when the project Output Directory is "public" (Express preset).
 * Re-exports the dashboard API app from ../src/server.js
 */
import express from "express";
import app from "../src/server.js";
void express;
export default app;
