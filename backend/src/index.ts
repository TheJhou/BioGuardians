import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import referenciasRoutes from './routes/referencias.js';
import especiesRoutes from './routes/especies.js';
import areasRoutes from './routes/areas.js';
import ocorrenciasRoutes from './routes/ocorrencias.js';
import dashboardRoutes from './routes/dashboard.js';

const app = express();

// --- Middleware ---
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: '10mb' }));

// --- Health check ---
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Routes ---
app.use('/api', referenciasRoutes);
app.use('/api/especies', especiesRoutes);
app.use('/api/areas', areasRoutes);
app.use('/api/ocorrencias', ocorrenciasRoutes);
app.use('/api/dashboard', dashboardRoutes);

// --- Error handling ---
app.use(errorHandler);

// --- Start ---
app.listen(env.port, () => {
  console.log(`BioGuardians API running on port ${env.port}`);
});

export default app;
