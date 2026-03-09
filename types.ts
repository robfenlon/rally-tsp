export type RouteMetric = {
  value: number;
  text: string;
};

export type RouteInfo = {
  distance: RouteMetric;
  duration: RouteMetric;
};

export type JourneyLeg = {
  fromName: string;
  toName: string;
  route: RouteInfo;
  weighting: number;
};

export type JourneyEntry = {
  to: string;
  from?: string;
  distance: number;
  duration: number;
  cumulativeTime: number;
  cumulativeDistance: number;
  cumulativeWeighting: number;
  distanceText: string;
  durationText: string;
  weighting: number;
};
