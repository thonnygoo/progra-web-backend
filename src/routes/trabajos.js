import { Router } from 'express'
import { autenticar, permitirRoles } from '../middleware/autenticacion.js'
import { autenticarConfiguracion } from '../middleware/sesionComite.js'
import {
  crearAsignacionesTrabajo,
  obtenerHistorialAsignacionesTrabajo,
  obtenerTrabajosRecibidos,
} from '../controllers/AsignacionRevisionController.js'
import { trabajos_revisiones } from '../controllers/RevisionBDController.js'
import { crearTrabajo, opciones } from '../controllers/TrabajoAutorController.js'

const router = Router()
const comite = permitirRoles('committee')
const autor = permitirRoles('author', 'both')

router.get('/trabajos', autenticarConfiguracion, comite, (req, res, next) => {
  if (req.query.vista === 'recibidos') return obtenerTrabajosRecibidos(req, res, next)
  return trabajos_revisiones(req, res)
})
router.get('/trabajos/ediciones', autenticar, autor, opciones)
router.post('/trabajos', autenticar, autor, crearTrabajo)
router.get('/trabajos/:trabajoId/historial_asignaciones', autenticar, comite, obtenerHistorialAsignacionesTrabajo)
router.post('/trabajos/:trabajoId/asignaciones_revision', autenticar, comite, crearAsignacionesTrabajo)

export default router
