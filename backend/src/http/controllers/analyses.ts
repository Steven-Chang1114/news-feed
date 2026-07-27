import { createAnalysisRequestSchema, listAnalysesQuerySchema } from '@news-feed/api-contract';
import { Router } from 'express';
import { z } from 'zod';
import { notFoundError, validationError } from '../../errors';
import type { AnalysisService } from '../../services/analysisService';

const idSchema = z.string().uuid();

export function createAnalysesController(analyses: AnalysisService): Router {
  const controller = Router();

  controller.get('/', async (req, res) => {
    const query = listAnalysesQuerySchema.safeParse(req.query);
    if (!query.success) throw validationError(query.error.flatten().fieldErrors);

    res.json(await analyses.list(query.data));
  });

  controller.post('/', async (req, res) => {
    const body = createAnalysisRequestSchema.safeParse(req.body);
    if (!body.success) throw validationError(body.error.flatten().fieldErrors);

    // 201 whether or not an analysis for this URL existed: re-analyzing produces a
    // new result that replaces the old one, so a resource is created either way.
    res.status(201).json(await analyses.analyze(body.data.article));
  });

  controller.delete('/:id', async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    // A malformed id cannot match anything, so it reads as absent rather than invalid.
    if (!id.success) throw notFoundError('No such analysis');

    if (!(await analyses.delete(id.data))) throw notFoundError('No such analysis');

    res.status(204).end();
  });

  return controller;
}
