import type { DomeModel } from '../types'

/**
 * Wavefront OBJ: dome surface as faces plus one line-group per strut type.
 * Vertices are emitted in working units (inches or mm).
 */
export function domeObj(model: DomeModel, radius: number): string {
  const lines: string[] = [
    '# domez geodesic dome',
    `# frequency ${model.params.frequency} fraction ${model.params.fraction}`,
  ]
  for (const v of model.vertices) {
    const [x, y, z] = v.position
    lines.push(`v ${(x * radius).toFixed(6)} ${(y * radius).toFixed(6)} ${(z * radius).toFixed(6)}`)
  }
  lines.push('g panels')
  for (const f of model.faces) {
    lines.push(`f ${f.vertexIds[0] + 1} ${f.vertexIds[1] + 1} ${f.vertexIds[2] + 1}`)
  }
  for (const t of model.strutTypes) {
    lines.push(`g struts_${t.label}`)
    for (const eid of t.edgeIds) {
      const e = model.edges[eid]
      lines.push(`l ${e.v0 + 1} ${e.v1 + 1}`)
    }
  }
  return lines.join('\n') + '\n'
}
