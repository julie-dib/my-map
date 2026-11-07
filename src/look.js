// Drawing choices that are not scenario assumptions: they only shape how things look.
// All colours, widths and spacings that are assumptions live in public/data/scenario.json.

// Parked cars (Today only): a low rounded body and a smaller cabin on top.
export const CAR_LENGTH_M = 4.4
export const CAR_WIDTH_M = 1.8
export const CAR_HEIGHT_M = 1.5
// Cars stand this far to the right of the street centre line, bikes further out at the edge.
export const CAR_LANE_OFFSET_M = 1.6
export const BIKE_SIDE_OFFSET_M = 3.2
// No car or bike closer than this to the end of a street, so the junctions stay clear.
export const JUNCTION_CLEARANCE_M = 8

// Parked buses (Today only): one long box.
export const BUS_LENGTH_M = 12
export const BUS_WIDTH_M = 2.55
export const BUS_HEIGHT_M = 3.1
export const BUS_LANE_OFFSET_M = 1.8
// The street graph has no bus stops and no road types, so buses stand on the "main roads":
// the longest street segments, this share of all segments.
export const MAIN_ROAD_SHARE = 0.1

// Figures on the paths (Around 2050 and Around 2100): a standing person and a small robot.
export const PERSON_HEIGHT_M = 1.7
export const ROBOT_HEIGHT_M = 0.6
// Smallest distance between two figures of one kind on the paths.
export const FIGURE_GAP_M = { person: 1.5, bike: 3, robot: 6 }

// Species routes: line widths in screen pixels (normal, selected, faded, and new: highlighted as
// new in the layout), the size of the
// arrowheads and crosses at their ends, and the habitat arrows on the map edge.
export const ROUTE_LINE_PX = { normal: 2.2, selected: 3.6, faded: 1.3, new: 4.4 }
export const ROUTE_DOT_PX = { normal: 4.5, selected: 6, faded: 3, new: 7.5 }
export const ARROWHEAD_M = 14
export const CROSS_M = 12
export const HABITAT_ARROW_M = { length: 70, width: 26 }

// The light layer (derived/light.json) is drawn this see-through over the ground.
export const LIGHT_LAYER_OPACITY = 0.8
