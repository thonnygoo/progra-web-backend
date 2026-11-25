import {
  sequelize,
  AsignacionRevision,
  Criterio,
  Decision,
  Revision,
  RevisionCriterio,
  Trabajo,
} from '../models/index.js'

const recomendaciones = new Map([
  ['aceptar', 'accept'],
  ['observaciones', 'revisions'],
  ['rechazar', 'reject'],
])
const recomendacionPublica = { accept: 'aceptar', revisions: 'observaciones', reject: 'rechazar' }
const resultados = new Map([['aceptar', 'accept'], ['rechazar', 'reject']])
const estadosTrabajo = {
  draft: 'Borrador',
  submitted: 'Enviado',
  under_review: 'En revisión',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
}
const datosTrabajo = ['owner', 'thematicAxis', 'workType']
const datosAsignacion = ['reviewer', { association: 'work', include: datosTrabajo }]

function idValido(id) {
  return /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 2147483647
}

function error(res, codigo, mensaje) {
  return res.status(codigo).json({ status: 'error', mensaje })
}

function participante(usuario) {
  const roles = { author: 'autor', reviewer: 'revisor', both: 'ambos', committee: 'comite' }
  return {
    id: usuario.id,
    nombre: usuario.fullName,
    correo: usuario.email,
    rol: roles[usuario.role],
    institucion: usuario.institution,
  }
}

function fichaTrabajo(trabajo) {
  return {
    id: trabajo.id,
    codigo: trabajo.code,
    titulo: trabajo.title,
    eje: trabajo.thematicAxis?.name,
    tipo: trabajo.workType?.name,
    estado: estadosTrabajo[trabajo.status],
    autorId: trabajo.ownerId,
  }
}

function fichaDecision(decision) {
  if (!decision) return null
  return {
    id: decision.id,
    trabajoId: decision.workId,
    resultado: recomendacionPublica[decision.result],
    retroalimentacion: decision.feedback,
    estado: decision.status === 'published' ? 'publicada' : 'borrador',
    fechaPublicacion: decision.publishedAt,
  }
}

function fichaRevision(revision, asignacion, catalogo = []) {
  const notas = new Map(revision.scores.map(nota => [nota.criterionId, nota]))
  const criterios = catalogo.length
    ? catalogo.map(criterio => notas.get(criterio.id) ?? {
      criterionId: criterio.id,
      criterionName: criterio.name,
      criterionWeight: criterio.weight,
      score: null,
      comment: '',
    })
    : revision.scores
  return {
    id: revision.id,
    trabajoId: asignacion.workId,
    revisorId: asignacion.reviewerId,
    fechaLimite: asignacion.dueDate,
    fechaEnvio: revision.submittedAt,
    estado: revision.status === 'submitted' ? 'enviada' : 'borrador',
    recomendacion: recomendacionPublica[revision.recommendation] ?? '',
    comentarioAutor: revision.authorComment,
    comentarioComite: revision.committeeComment,
    criterios: criterios.map(nota => ({
      id: nota.id ?? null,
      revisionId: revision.id,
      criterioId: nota.criterionId,
      puntaje: nota.score,
      comentario: nota.comment,
      criterio: { id: nota.criterionId, nombre: nota.criterionName, peso: nota.criterionWeight },
    })),
  }
}

function notaPonderada(notas) {
  const calificadas = notas.filter(nota => nota.score !== null)
  const pesoTotal = calificadas.reduce((total, nota) => total + nota.criterionWeight, 0)
  if (!pesoTotal) return null
  const suma = calificadas.reduce((total, nota) => total + nota.score * nota.criterionWeight, 0)
  return Math.round(suma * 10 / pesoTotal) / 10
}

export async function revisiones(req, res) {
  const usuario = res.locals.usuario
  const filas = await Revision.findAll({
    order: [['id', 'ASC']],
    include: [
      {
        association: 'assignment',
        include: datosAsignacion,
        where: usuario.rol === 'committee' ? undefined : { reviewerId: usuario.id },
      },
      'scores',
    ],
  })
  const ediciones = [...new Set(filas.filter(r => r.status === 'draft').map(r => r.assignment.work.editionId))]
  const criterios = ediciones.length
    ? await Criterio.findAll({ where: { editionId: ediciones }, order: [['id', 'ASC']] })
    : []
  return res.json({
    status: 'success',
    data: filas.map(revision => {
      const { assignment: asignacion } = revision
      return {
        ...fichaRevision(revision, asignacion, revision.status === 'draft'
          ? criterios.filter(criterio => criterio.editionId === asignacion.work.editionId)
          : []),
        trabajo: fichaTrabajo(asignacion.work),
        revisor: participante(asignacion.reviewer),
      }
    }),
  })
}

export async function trabajos_revisiones(req, res) {
  const trabajos = await Trabajo.findAll({
    order: [['code', 'ASC']],
    include: [...datosTrabajo, 'decision', { association: 'assignments', include: [{ association: 'review', include: ['scores'] }] }],
  })
  return res.json({
    status: 'success',
    data: trabajos.map(trabajo => ({
      ...fichaTrabajo(trabajo),
      autor: participante(trabajo.owner),
      decision: fichaDecision(trabajo.decision),
      revisiones: trabajo.assignments.filter(a => a.review).map(a => fichaRevision(a.review, a)),
    })),
  })
}

export async function decisiones(req, res) {
  const usuario = res.locals.usuario
  const filas = await Decision.findAll({
    order: [['id', 'ASC']],
    where: usuario.rol === 'committee' ? undefined : { status: 'published' },
    include: [{
      association: 'work',
      where: usuario.rol === 'committee' ? undefined : { ownerId: usuario.id },
      include: datosTrabajo,
    }],
  })
  return res.json({
    status: 'success',
    data: filas.map(decision => ({ ...fichaDecision(decision), trabajo: fichaTrabajo(decision.work) })),
  })
}

export async function consolidado(req, res) {
  const { trabajoId } = req.params
  if (!idValido(trabajoId)) return error(res, 400, 'El ID del trabajo no es válido.')
  const trabajo = await Trabajo.findByPk(trabajoId, {
    include: [
      'decision',
      { association: 'assignments', include: ['reviewer', { association: 'review', include: ['scores'] }] },
    ],
  })
  if (!trabajo) return error(res, 404, 'El trabajo no existe.')

  const filas = trabajo.assignments.map(({ review: revision, reviewer: revisor }) => {
    const enviada = revision?.status === 'submitted'
    return {
      revisionId: revision?.id ?? null,
      revisor: revisor.fullName,
      estado: enviada ? 'enviada' : 'borrador',
      recomendacion: enviada ? recomendacionPublica[revision.recommendation] : null,
      notaPonderada: enviada ? notaPonderada(revision.scores) : null,
      comentarioAutor: enviada ? revision.authorComment : '',
      comentarioComite: enviada ? revision.committeeComment : '',
    }
  })
  const notas = filas.map(fila => fila.notaPonderada).filter(nota => nota !== null)
  return res.json({
    status: 'success',
    data: {
      trabajo: { id: trabajo.id, codigo: trabajo.code, titulo: trabajo.title },
      revisiones: filas,
      resumen: {
        total: filas.length,
        enviadas: filas.filter(fila => fila.estado === 'enviada').length,
        promedioGeneral: notas.length ? Math.round(notas.reduce((a, b) => a + b, 0) * 10 / notas.length) / 10 : null,
        recomiendanAceptar: filas.filter(fila => fila.recomendacion === 'aceptar').length,
      },
      decision: fichaDecision(trabajo.decision),
    },
  })
}

function criterioValido(criterio) {
  return criterio && Number.isInteger(criterio.criterioId) && criterio.criterioId > 0 &&
    (criterio.puntaje == null || (Number.isInteger(criterio.puntaje) && criterio.puntaje >= 0 && criterio.puntaje <= 20)) &&
    (criterio.comentario == null || typeof criterio.comentario === 'string')
}

export async function guardarRevision(req, res) {
  const { id } = req.params
  if (!idValido(id)) return error(res, 400, 'El ID de la revisión no es válido.')
  const {
    estado = 'borrador',
    recomendacion = '',
    comentarioAutor = '',
    comentarioComite = '',
    criterios = [],
  } = req.body ?? {}

  if (!['borrador', 'enviada'].includes(estado) ||
      (recomendacion !== '' && !recomendaciones.has(recomendacion)) ||
      typeof comentarioAutor !== 'string' || typeof comentarioComite !== 'string' ||
      !Array.isArray(criterios) || !criterios.every(criterioValido)) {
    return error(res, 400, 'Los datos de la revisión no son válidos.')
  }
  const ids = new Set(criterios.map(criterio => criterio.criterioId))
  if (ids.size !== criterios.length) return error(res, 400, 'No repitas criterios en la evaluación.')

  const enviada = estado === 'enviada'
  const usuario = res.locals.usuario
  const resultado = await sequelize.transaction(async transaction => {
    const revision = await Revision.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE })
    if (!revision) return { codigo: 404, mensaje: 'La revisión no existe.' }
    const asignacion = await AsignacionRevision.findByPk(revision.assignmentId, { transaction, include: ['work'] })
    if (asignacion.reviewerId !== usuario.id) return { codigo: 404, mensaje: 'La revisión no existe.' }
    if (revision.status === 'submitted') return { codigo: 409, mensaje: 'La evaluación ya fue enviada y no admite cambios.' }

    const criteriosEdicion = await Criterio.findAll({
      where: { editionId: asignacion.work.editionId },
      transaction,
      lock: transaction.LOCK.SHARE,
    })
    const catalogo = new Map(criteriosEdicion.map(criterio => [criterio.id, criterio]))
    if (criterios.some(criterio => !catalogo.has(criterio.criterioId))) {
      return { codigo: 400, mensaje: 'Usa los criterios de la edición del trabajo.' }
    }
    if (enviada && (!catalogo.size || ids.size !== catalogo.size || !recomendacion ||
        !comentarioAutor.trim() || criterios.some(criterio => criterio.puntaje == null || !criterio.comentario?.trim()))) {
      return {
        codigo: 400,
        mensaje: 'Para enviar, califica y comenta todos los criterios, elige una recomendación y escribe el comentario al autor.',
      }
    }

    await revision.update({
      status: enviada ? 'submitted' : 'draft',
      recommendation: recomendaciones.get(recomendacion) ?? null,
      authorComment: comentarioAutor,
      committeeComment: comentarioComite,
      submittedAt: enviada ? new Date() : null,
    }, { transaction })
    await RevisionCriterio.destroy({ where: { reviewId: revision.id }, transaction })
    const notas = await RevisionCriterio.bulkCreate(criterios.map(criterio => {
      const vigente = catalogo.get(criterio.criterioId)
      return {
        reviewId: revision.id,
        criterionId: vigente.id,
        criterionName: vigente.name,
        criterionWeight: vigente.weight,
        score: criterio.puntaje ?? null,
        comment: criterio.comentario ?? '',
      }
    }), { transaction, validate: true })
    revision.scores = notas
    return { data: fichaRevision(revision, asignacion) }
  })
  if (resultado.codigo) return error(res, resultado.codigo, resultado.mensaje)
  return res.json({ status: 'success', data: resultado.data })
}

export async function guardarDecision(req, res) {
  const { trabajoId } = req.params
  if (!idValido(trabajoId)) return error(res, 400, 'El ID del trabajo no es válido.')
  const { resultado, retroalimentacion = '', estado = 'borrador' } = req.body ?? {}
  if (!resultados.has(resultado) || !['borrador', 'publicada'].includes(estado) || typeof retroalimentacion !== 'string') {
    return error(res, 400, 'Los datos del dictamen no son válidos.')
  }

  const publicada = estado === 'publicada'
  const guardado = await sequelize.transaction(async transaction => {
    const trabajo = await Trabajo.findByPk(trabajoId, { transaction, lock: transaction.LOCK.UPDATE })
    if (!trabajo) return { codigo: 404, mensaje: 'El trabajo no existe.' }
    const existente = await Decision.findOne({ where: { workId: trabajo.id }, transaction })
    if (existente?.status === 'published') return { codigo: 409, mensaje: 'La decisión ya fue publicada.' }

    const datos = {
      workId: trabajo.id,
      result: resultados.get(resultado),
      feedback: retroalimentacion,
      status: publicada ? 'published' : 'draft',
      publishedAt: publicada ? new Date() : null,
    }
    const decision = existente
      ? await existente.update(datos, { transaction })
      : await Decision.create(datos, { transaction })
    if (publicada) {
      await trabajo.update({ status: resultado === 'aceptar' ? 'accepted' : 'rejected' }, { transaction })
    }
    return { codigo: existente ? 200 : 201, data: fichaDecision(decision) }
  })
  if (guardado.mensaje) return error(res, guardado.codigo, guardado.mensaje)
  return res.status(guardado.codigo).json({ status: 'success', data: guardado.data })
}
