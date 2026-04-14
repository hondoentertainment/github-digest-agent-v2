/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export function requireAdmin(req, res, next) {
  const role = req.auth?.role;
  if (role !== "admin") {
    return res.status(403).json({ status: "forbidden", message: "Admin role required." });
  }
  next();
}
