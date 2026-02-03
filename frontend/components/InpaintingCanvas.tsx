"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Rect } from "react-konva";
import useImage from "use-image";
import Konva from "konva";

// Define the ref handle type
// Define the ref handle type
export interface InpaintingCanvasHandle {
  clearLines: () => void;
  undo: () => void;
  redo: () => void;
}

export type ToolType = 'brush' | 'eraser' | 'rectangle' | 'lasso';

interface InpaintingCanvasProps {
  imageSrc: string;
  onMaskReady: (maskBlob: Blob | null) => void;
  brushSize: number;
  tool: ToolType;
}

interface MaskShape {
  type: 'line' | 'rectangle' | 'lasso';
  tool: string;
  points: number[];
  brushSize: number;
  // For rectangle
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

const URLImage = ({ src, onImageLoad, width, height }: { src: string; onImageLoad: (width: number, height: number) => void; width: number; height: number }) => {
  const [image] = useImage(src);
  useEffect(() => {
    if (image) {
      onImageLoad(image.width, image.height);
    }
  }, [image, onImageLoad]);

  return <KonvaImage image={image} width={width} height={height} />;
};

const InpaintingCanvas = React.forwardRef<InpaintingCanvasHandle, InpaintingCanvasProps>(({
  imageSrc,
  onMaskReady,
  brushSize,
  tool,
}, ref) => {
  const [shapes, setShapes] = useState<MaskShape[]>([]);
  const [futureShapes, setFutureShapes] = useState<MaskShape[]>([]);
  const isDrawing = useRef(false);
  const stageRef = useRef<Konva.Stage>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  // For rectangle drawing
  const [rectStart, setRectStart] = useState<{ x: number, y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<{ x: number, y: number, width: number, height: number } | null>(null);

  // Expose methods to parent
  React.useImperativeHandle(ref, () => ({
    clearLines: () => {
      setShapes([]);
      setFutureShapes([]);
      onMaskReady(null);
    },
    undo: () => {
      setShapes((prev) => {
        if (prev.length === 0) return prev;
        const newShapes = prev.slice(0, -1);
        setFutureShapes(f => [prev[prev.length - 1], ...f]);
        // We need to re-export mask after undo
        // setTimeout to ensure state update? No, exportMask uses argument usually.
        // But we can't call exportMask here easily with the *new* state because of closure.
        // We'll rely on useEffect or manual update.
        // Actually exportMask depends on 'shapes', so we should trigger it.
        // Using a simplistic timeout or ref approach might be needed, or just let the effect handle it.
        return newShapes;
      });
    },
    redo: () => {
      setFutureShapes((prev) => {
        if (prev.length === 0) return prev;
        const [nextShape, ...rest] = prev;
        setShapes(s => [...s, nextShape]);
        return rest;
      });
    }
  }));

  // Trigger export when shapes change (for undo/redo to update maskBlob)
  useEffect(() => {
    if (shapes.length >= 0) { // Always run if shapes exist (or become empty)
      // Debounce slightly to avoid excessive exports during drawing?
      // But for undo/redo it's 1-off.
      // We need to verify if stage is ready.
      const timer = setTimeout(() => exportMask(shapes), 50);
      return () => clearTimeout(timer);
    }
  }, [shapes.length]); // Only re-export when count changes (end of stroke, undo, redo)

  useEffect(() => {
    // Reset shapes when image changes
    setShapes([]);
    setFutureShapes([]);
    // Don't reset dimensions to 0 - let handleImageLoad update them
    // This prevents blank canvas during undo/image change transitions
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [imageSrc]);

  // Zoom with mouse wheel
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.1;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.5, Math.min(5, newScale));

    // Calculate new position to zoom toward pointer
    const mousePointTo = {
      x: (pointer.x - position.x) / oldScale,
      y: (pointer.y - position.y) / oldScale,
    };

    const newPos = {
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    };

    setScale(clampedScale);
    setPosition(newPos);
  }, [scale, position]);

  const getScaledPointerPosition = (stage: Konva.Stage) => {
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    return {
      x: (pointer.x - position.x) / scale,
      y: (pointer.y - position.y) / scale,
    };
  };

  const handleMouseDown = (e: any) => {
    // Pan with middle mouse or space+click
    if (e.evt.button === 1) {
      return; // Let Konva handle middle mouse for dragging
    }

    const stage = e.target.getStage();
    const pos = getScaledPointerPosition(stage);
    if (!pos) return;

    isDrawing.current = true;
    setFutureShapes([]); // Clear redo history on new action

    if (tool === 'rectangle') {
      setRectStart(pos);
      setCurrentRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
    } else if (tool === 'lasso') {
      setShapes([...shapes, { type: 'lasso', tool: 'brush', points: [pos.x, pos.y], brushSize: 2 }]);
    } else {
      setShapes([...shapes, { type: 'line', tool, points: [pos.x, pos.y], brushSize }]);
    }
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing.current) return;

    const stage = e.target.getStage();
    const pos = getScaledPointerPosition(stage);
    if (!pos) return;

    if (tool === 'rectangle' && rectStart) {
      setCurrentRect({
        x: Math.min(rectStart.x, pos.x),
        y: Math.min(rectStart.y, pos.y),
        width: Math.abs(pos.x - rectStart.x),
        height: Math.abs(pos.y - rectStart.y),
      });
    } else if (tool === 'lasso' || tool === 'brush' || tool === 'eraser') {
      const lastShape = shapes[shapes.length - 1];
      if (lastShape) {
        lastShape.points = lastShape.points.concat([pos.x, pos.y]);
        shapes.splice(shapes.length - 1, 1, lastShape);
        setShapes(shapes.concat());
      }
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;

    if (tool === 'rectangle' && currentRect && currentRect.width > 0 && currentRect.height > 0) {
      const newRect: MaskShape = {
        type: 'rectangle',
        tool: 'brush',
        points: [],
        brushSize,
        ...currentRect,
      };
      const newShapes = [...shapes, newRect];
      setShapes(newShapes);
      setCurrentRect(null);
      setRectStart(null);
      // Export with the new shapes array that includes the rectangle
      exportMask(newShapes);
    } else {
      exportMask(shapes);
    }
  };

  const exportMask = (shapesToExport: MaskShape[] = shapes) => {
    if (!stageRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fill black
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw shapes
    shapesToExport.forEach(shape => {
      const isEraser = shape.tool === 'eraser';
      ctx.fillStyle = isEraser ? 'black' : 'white';
      ctx.strokeStyle = isEraser ? 'black' : 'white';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = shape.brushSize || brushSize;

      if (shape.type === 'rectangle' && shape.x !== undefined && shape.y !== undefined && shape.width !== undefined && shape.height !== undefined) {
        ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
      } else if (shape.type === 'lasso' && shape.points.length > 4) {
        ctx.beginPath();
        ctx.moveTo(shape.points[0], shape.points[1]);
        for (let i = 2; i < shape.points.length; i += 2) {
          ctx.lineTo(shape.points[i], shape.points[i + 1]);
        }
        ctx.closePath();
        ctx.fill();
      } else if (shape.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(shape.points[0], shape.points[1]);
        for (let i = 2; i < shape.points.length; i += 2) {
          ctx.lineTo(shape.points[i], shape.points[i + 1]);
        }
        ctx.stroke();
      }
    });

    canvas.toBlob((blob) => {
      if (blob) onMaskReady(blob);
    });
  };

  const handleImageLoad = (w: number, h: number) => {
    let finalW = w;
    let finalH = h;
    if (w > 800) {
      const ratio = 800 / w;
      finalW = 800;
      finalH = h * ratio;
    }

    // Ensure integers for canvas dimensions to match internal canvas behavior
    finalW = Math.floor(finalW);
    finalH = Math.floor(finalH);

    if (finalW !== dimensions.width || finalH !== dimensions.height) {
      setDimensions({ width: finalW, height: finalH });
    }
  };

  if (!imageSrc) return <div>Please upload an image</div>;

  return (
    <div className="border border-gray-300 inline-block shadow-lg overflow-hidden rounded-lg relative">
      {/* Zoom controls */}
      <div className="absolute top-2 right-2 z-10 flex gap-1 bg-black/50 rounded-lg p-1">
        <button
          onClick={() => setScale(Math.min(5, scale * 1.2))}
          className="w-8 h-8 bg-neutral-700 hover:bg-neutral-600 rounded text-white text-lg font-bold"
        >
          +
        </button>
        <button
          onClick={() => setScale(Math.max(0.5, scale / 1.2))}
          className="w-8 h-8 bg-neutral-700 hover:bg-neutral-600 rounded text-white text-lg font-bold"
        >
          −
        </button>
        <button
          onClick={() => { setScale(1); setPosition({ x: 0, y: 0 }); }}
          className="px-2 h-8 bg-neutral-700 hover:bg-neutral-600 rounded text-white text-xs"
        >
          Reset
        </button>
      </div>

      {/* Zoom level indicator */}
      <div className="absolute bottom-2 right-2 z-10 bg-black/50 text-white text-xs px-2 py-1 rounded pointer-events-none">
        {Math.round(scale * 100)}%
      </div>

      <Stage
        width={dimensions.width}
        height={dimensions.height}
        onMouseDown={handleMouseDown}
        onMousemove={handleMouseMove}
        onMouseup={handleMouseUp}
        onWheel={handleWheel}
        ref={stageRef}
        scaleX={scale}
        scaleY={scale}
        x={position.x}
        y={position.y}
        draggable={tool === 'brush' ? false : false} // Can enable pan with space key later
      >
        <Layer>
          <URLImage
            src={imageSrc}
            onImageLoad={handleImageLoad}
            width={dimensions.width}
            height={dimensions.height}
          />
        </Layer>
        <Layer>
          {/* Render shapes */}
          {shapes.map((shape, i) => {
            if (shape.type === 'rectangle' && shape.x !== undefined && shape.y !== undefined && shape.width !== undefined && shape.height !== undefined) {
              return (
                <Rect
                  key={i}
                  x={shape.x}
                  y={shape.y}
                  width={shape.width}
                  height={shape.height}
                  fill="#df4b26"
                  opacity={0.6}
                />
              );
            } else if (shape.type === 'lasso') {
              return (
                <Line
                  key={i}
                  points={shape.points}
                  stroke="#df4b26"
                  strokeWidth={2}
                  closed={true}
                  fill="#df4b2680"
                  opacity={0.6}
                />
              );
            } else {
              return (
                <Line
                  key={i}
                  points={shape.points}
                  stroke={shape.tool === 'eraser' ? '#4a90d9' : '#df4b26'}
                  strokeWidth={shape.brushSize || brushSize}
                  tension={0.5}
                  lineCap="round"
                  lineJoin="round"
                  opacity={0.8}
                  globalCompositeOperation={shape.tool === 'eraser' ? 'destination-out' : 'source-over'}
                />
              );
            }
          })}

          {/* Current rectangle being drawn */}
          {currentRect && (
            <Rect
              x={currentRect.x}
              y={currentRect.y}
              width={currentRect.width}
              height={currentRect.height}
              stroke="#df4b26"
              strokeWidth={2}
              dash={[5, 5]}
              fill="#df4b2640"
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
});

export default InpaintingCanvas;
