// ==============================================================================
// TALLERO AUTO — ENDPOINT COUNTER & MATCHER
// Menghitung jumlah nyata endpoint di src/routes/, docs/openapi.json, dan docs/postman
// ==============================================================================

import fs from "node:fs";
import path from "node:path";
import authRouter from "../src/routes/auth.routes.js";
import filesRouter from "../src/routes/files.routes.js";
import availabilityRouter from "../src/routes/availability.routes.js";
import adminUsersRouter from "../src/routes/users.routes.js";
import { adminOutletsRouter, publicOutletsRouter } from "../src/routes/outlets.routes.js";
import {
  adminCategoriesRouter,
  adminServicesRouter,
  publicCategoriesRouter,
  publicServicesRouter,
} from "../src/routes/catalog.routes.js";
import { adminSparepartsRouter, sparepartsRouter } from "../src/routes/spareparts.routes.js";
import vehiclesRouter from "../src/routes/vehicles.routes.js";
import bookingsRouter from "../src/routes/bookings.routes.js";
import staffRouter from "../src/routes/staff.routes.js";
import auditRouter from "../src/routes/audit.routes.js";
import paymentsRouter from "../src/routes/payments.routes.js";
import notificationsRouter from "../src/routes/notifications.routes.js";
import assistantRouter from "../src/routes/assistant.routes.js";
import adminReviewsRouter from "../src/routes/reviews.routes.js";
import { adminDashboardRouter, adminReportsRouter } from "../src/routes/reports.routes.js";

export const getMountedRoutes = () => {
  const mounts = [
    { prefix: "/api/v1/auth", router: authRouter },
    { prefix: "/api/v1/files", router: filesRouter },
    { prefix: "/api/v1/outlets", router: availabilityRouter },
    { prefix: "/api/v1/outlets", router: publicOutletsRouter },
    { prefix: "/api/v1/categories", router: publicCategoriesRouter },
    { prefix: "/api/v1/services", router: publicServicesRouter },
    { prefix: "/api/v1/spareparts", router: sparepartsRouter },
    { prefix: "/api/v1/vehicles", router: vehiclesRouter },
    { prefix: "/api/v1/bookings", router: bookingsRouter },
    { prefix: "/api/v1/payments", router: paymentsRouter },
    { prefix: "/api/v1/notifications", router: notificationsRouter },
    { prefix: "/api/v1/assistant", router: assistantRouter },
    { prefix: "/api/v1/staff", router: staffRouter },
    { prefix: "/api/v1/admin/users", router: adminUsersRouter },
    { prefix: "/api/v1/admin/outlets", router: adminOutletsRouter },
    { prefix: "/api/v1/admin/categories", router: adminCategoriesRouter },
    { prefix: "/api/v1/admin/services", router: adminServicesRouter },
    { prefix: "/api/v1/admin/spareparts", router: adminSparepartsRouter },
    { prefix: "/api/v1/admin/reviews", router: adminReviewsRouter },
    { prefix: "/api/v1/admin/audit-logs", router: auditRouter },
    { prefix: "/api/v1/admin/dashboard", router: adminDashboardRouter },
    { prefix: "/api/v1/admin/reports", router: adminReportsRouter },
  ];

  const endpoints = [
    { method: "GET", path: "/api/v1/health" },
    { method: "GET", path: "/api/v1/ready" },
  ];

  for (const m of mounts) {
    for (const layer of m.router.stack) {
      if (layer.route) {
        const p = (m.prefix + layer.route.path).replace(/\/+/g, "/").replace(/\/$/, "") || "/";
        const methods = Object.keys(layer.route.methods)
          .filter((k) => layer.route.methods[k])
          .map((k) => k.toUpperCase());
        for (const meth of methods) {
          endpoints.push({ method: meth, path: p });
        }
      }
    }
  }

  endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return endpoints;
};

export const main = () => {
  const expressEndpoints = getMountedRoutes();

  console.log(`\n======================================================`);
  console.log(`TOTAL ENDPOINT DI SRC/ROUTES/: ${expressEndpoints.length}`);
  console.log(`======================================================`);

  const openApiPath = path.resolve(process.cwd(), "docs/openapi.json");
  let openApiOpsCount = 0;
  if (fs.existsSync(openApiPath)) {
    const openApi = JSON.parse(fs.readFileSync(openApiPath, "utf8"));
    const openApiOps = [];
    for (const [p, methods] of Object.entries(openApi.paths)) {
      for (const m of Object.keys(methods)) {
        openApiOps.push({ method: m.toUpperCase(), path: `/api/v1${p}` });
      }
    }
    openApiOpsCount = openApiOps.length;
    console.log(`TOTAL ENDPOINT DI DOCS/OPENAPI.JSON: ${openApiOpsCount}`);
  }

  const postmanPath = path.resolve(process.cwd(), "docs/tallero-auto.postman_collection.json");
  let postmanCount = 0;
  if (fs.existsSync(postmanPath)) {
    const postman = JSON.parse(fs.readFileSync(postmanPath, "utf8"));
    const postmanItems = [];
    const collectItems = (items) => {
      for (const item of items) {
        if (item.request) {
          postmanItems.push({
            name: item.name,
            method: item.request.method,
            path: item.request.url.path ? "/" + item.request.url.path.join("/") : "",
          });
        }
        if (item.item) {
          collectItems(item.item);
        }
      }
    };
    collectItems(postman.item || []);
    postmanCount = postmanItems.length;
    console.log(`TOTAL ENDPOINT DI DOCS/POSTMAN: ${postmanCount}`);
  }

  console.log(`\nSTATUS KELENGKAPAN:`);
  console.log(`- Routes:  ${expressEndpoints.length}`);
  console.log(`- OpenAPI: ${openApiOpsCount}`);
  console.log(`- Postman: ${postmanCount}`);

  if (expressEndpoints.length === openApiOpsCount && openApiOpsCount === postmanCount) {
    console.log(`\n✅ SEMUA ANGKA IDENTIK (106 == 106 == 106). SESUAI TARGET!`);
  } else {
    console.error(`\n❌ TERDAPAT KETIDAKSINKRONAN!`);
    process.exit(1);
  }
};

const isDirectRun =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isDirectRun) {
  main();
}
