// src/components/wizard/ResizeHandle.tsx
"use client";

import { useDraggable } from "@dnd-kit/core";

// The positions for the handles
export const HANDLE_POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const;
export type HandlePosition = typeof HANDLE_POSITIONS[number];

interface ResizeHandleProps {
  elementId: string;
  position: HandlePosition;
}

export function ResizeHandle({ elementId, position }: ResizeHandleProps) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `${elementId}-handle-${position}`, // Unique ID for each handle
  });

  const getHandleStyle = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      width: '10px',
      height: '10px',
      backgroundColor: 'white',
      border: '1px solid #3b82f6',
      borderRadius: '2px',
      zIndex: 101, // Above the element
    };

    // Position handles around the element
    if (position.includes('top')) baseStyle.top = '-5px';
    if (position.includes('bottom')) baseStyle.bottom = '-5px';
    if (position.includes('left')) baseStyle.left = '-5px';
    if (position.includes('right')) baseStyle.right = '-5px';
    if (position.includes('center')) {
        baseStyle.left = 'calc(50% - 5px)';
    }
     if (position.includes('middle')) {
        baseStyle.top = 'calc(50% - 5px)';
    }

    // Set cursor style to indicate resize direction
    if (position === 'top-left' || position === 'bottom-right') baseStyle.cursor = 'nwse-resize';
    if (position === 'top-right' || position === 'bottom-left') baseStyle.cursor = 'nesw-resize';
    if (position === 'top-center' || position === 'bottom-center') baseStyle.cursor = 'ns-resize';
    if (position === 'middle-left' || position === 'middle-right') baseStyle.cursor = 'ew-resize';

    return baseStyle;
  };

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={getHandleStyle()} />
  );
}