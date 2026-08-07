/** Core data model for the parametric dome engine. All canonical geometry is
 * computed on a unit-radius sphere; lengths scale linearly with radius. */

export type Vec3 = readonly [number, number, number]

export type Frequency = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export type Fraction = '3/8' | '1/2' | '5/8' | 'full'
export type UnitSystem = 'imperial' | 'metric'

export interface DomeParams {
  frequency: Frequency
  fraction: Fraction
}

export interface Vertex {
  id: number
  /** Position on the unit sphere (canonical). */
  position: Vec3
  /** Incident edge ids, filled after edge construction. */
  edgeIds: number[]
  /** Hub type id (index into DomeModel.hubTypes), -1 until classified. */
  hubTypeId: number
  /** True when the vertex sits on the truncation ring (base perimeter). */
  isBase: boolean
}

export interface Edge {
  id: number
  v0: number
  v1: number
  /** Chord length on the unit sphere = chord factor. */
  chordFactor: number
  /** Strut type id (index into DomeModel.strutTypes). */
  typeId: number
  /** Adjacent face ids (1 on the base perimeter, else 2). */
  faceIds: number[]
  /** Dihedral angle between adjacent faces in degrees (NaN when boundary). */
  dihedralDeg: number
}

export interface Face {
  id: number
  vertexIds: [number, number, number]
  /** Neighboring face ids sharing an edge. */
  neighborIds: number[]
  /** Edge ids of this face. */
  edgeIds: number[]
}

export interface StrutType {
  id: number
  /** Label A, B, C, ... ordered shortest first. */
  label: string
  chordFactor: number
  count: number
  /** Angle between strut axis and the radial (hub) axis at its end, degrees.
   * This is the hub-end cut angle: 90 - asin(chordFactor / 2). */
  axialAngleDeg: number
  /** Range of face dihedrals observed across edges of this type, degrees. */
  dihedralMinDeg: number
  dihedralMaxDeg: number
  edgeIds: number[]
}

export interface HubType {
  id: number
  /** Label H1, H2, ... */
  label: string
  /** Number of struts meeting at the hub. */
  valence: number
  /** Sorted strut-type labels around the hub, e.g. "A-A-B-B-B". */
  pattern: string
  isBase: boolean
  count: number
  vertexIds: number[]
}

export interface DomeModel {
  params: DomeParams
  vertices: Vertex[]
  edges: Edge[]
  faces: Face[]
  strutTypes: StrutType[]
  hubTypes: HubType[]
  /** z of the truncation plane on the unit sphere (-1..1). */
  cutZ: number
  /** Actual kept fraction of the sphere's height: (1 - cutZ) / 2. */
  actualFraction: number
  /** Dome height for unit radius: 1 - cutZ. */
  unitHeight: number
  /** Radius of the base perimeter ring for unit radius. */
  unitBaseRadius: number
}

/** Full icosphere prior to truncation (used internally and for tests). */
export interface Icosphere {
  vertices: Vec3[]
  /** Faces with outward (CCW from outside) winding. */
  faces: [number, number, number][]
}
