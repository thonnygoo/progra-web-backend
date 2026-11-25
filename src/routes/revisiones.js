import { Router } from 'express'
import { permitirRoles } from '../middleware/autenticacion.js'
import { autenticarConfiguracion as autenticar } from '../middleware/sesionComite.js'
import {
  consolidado,
  decisiones,
  guardarDecision,
  guardarRevision,
  revisiones,
} from '../controllers/RevisionBDController.js'

const router = Router()
const revisar = permitirRoles('reviewer', 'both')
const comite = permitirRoles('committee')

router.get('/revisiones', autenticar, permitirRoles('reviewer', 'both', 'committee'), revisiones)
router.get('/decisiones', autenticar, permitirRoles('author', 'both', 'committee'), decisiones)
router.get('/trabajos/:trabajoId/revisiones', autenticar, comite, consolidado)
router.put('/revisiones/:id', autenticar, revisar, guardarRevision)
router.put('/decisiones/:trabajoId', autenticar, comite, guardarDecision)

export default router
