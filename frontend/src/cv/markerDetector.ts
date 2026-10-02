import { acquireResource } from "../diagnostics/performanceMetrics";
import cvModule from "@techstark/opencv-js";
import type { MarkerDetectionResult, MarkerObservation, Point } from "./types";

type CvMat = {
  data32F: Float32Array;
  data32S: Int32Array;
  rows: number;
  cols: number;
  delete: () => void;
};

type CvMatVector = {
  size: () => number;
  get: (index: number) => CvMat;
  delete: () => void;
};

type CvDetector = {
  detectMarkers: (
    image: CvMat,
    corners: CvMatVector,
    ids: CvMat,
    rejected: CvMatVector,
  ) => void;
  delete: () => void;
};

type CvRuntime = {
  Mat: new (...args: unknown[]) => CvMat;
  MatVector: new () => CvMatVector;
  imread: (source: HTMLCanvasElement) => CvMat;
  getPredefinedDictionary: (dictionary: number) => CvMat;
  aruco_DetectorParameters: new () => { delete: () => void };
  aruco_RefineParameters: new (
    minRepDistance: number,
    errorCorrectionRate: number,
    checkAllOrders: boolean,
  ) => { delete: () => void };
  aruco_ArucoDetector: new (
    dictionary: CvMat,
    parameters: { delete: () => void },
    refineParameters: { delete: () => void },
  ) => CvDetector;
  DICT_4X4_50: number;
};

let cvPromise: Promise<CvRuntime> | undefined;

async function loadOpenCv(): Promise<CvRuntime> {
  if (!cvPromise) {
    cvPromise = (async () => {
      if (cvModule instanceof Promise) {
        return await cvModule;
      }

      if (cvModule.Mat) {
        return cvModule;
      }

      await new Promise<void>((resolve) => {
        cvModule.onRuntimeInitialized = () => resolve();
      });

      return cvModule;
    })();
  }

  return cvPromise;
}

function pointFromCorner(corner: CvMat, index: number): Point {
  return {
    x: corner.data32F[index * 2],
    y: corner.data32F[index * 2 + 1],
  };
}

function observationFrom(corner: CvMat, id: number): MarkerObservation {
  const corners = [
    pointFromCorner(corner, 0),
    pointFromCorner(corner, 1),
    pointFromCorner(corner, 2),
    pointFromCorner(corner, 3),
  ] as [Point, Point, Point, Point];

  return {
    id,
    corners,
    center: {
      x: corners.reduce((sum, point) => sum + point.x, 0) / corners.length,
      y: corners.reduce((sum, point) => sum + point.y, 0) / corners.length,
    },
  };
}

export class MarkerDetector {
  private releaseResource = acquireResource("markerDetectors");
  private constructor(
    private readonly cv: CvRuntime,
    private readonly detector: CvDetector,
  ) {}

  static async create(): Promise<MarkerDetector> {
    const cv = await loadOpenCv();
    const dictionary = cv.getPredefinedDictionary(cv.DICT_4X4_50);
    const parameters = new cv.aruco_DetectorParameters();
    const refineParameters = new cv.aruco_RefineParameters(10, 3, true);
    const detector = new cv.aruco_ArucoDetector(
      dictionary,
      parameters,
      refineParameters,
    );

    dictionary.delete();
    parameters.delete();
    refineParameters.delete();

    return new MarkerDetector(cv, detector);
  }

  detect(canvas: HTMLCanvasElement): MarkerDetectionResult {
    const image = this.cv.imread(canvas);
    const corners = new this.cv.MatVector();
    const ids = new this.cv.Mat();
    const rejected = new this.cv.MatVector();

    try {
      this.detector.detectMarkers(image, corners, ids, rejected);
      const observations: MarkerObservation[] = [];

      for (let index = 0; index < corners.size(); index += 1) {
        const corner = corners.get(index);
        const id = ids.data32S[index];
        if (id === 0 || id === 1 || id === 2 || id === 3) {
          observations.push(observationFrom(corner, id));
        }
        corner.delete();
      }

      return {
        observations: observations.sort((a, b) => a.id - b.id),
        missingIds: [0, 1, 2, 3].filter(
          (id) => !observations.some((observation) => observation.id === id),
        ),
      };
    } finally {
      image.delete();
      corners.delete();
      ids.delete();
      rejected.delete();
    }
  }

  dispose(): void {
    this.detector.delete();
    this.releaseResource();
  }
}
