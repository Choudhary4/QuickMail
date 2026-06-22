// lib/types.ts

// The base properties for every element on the canvas
export interface CanvasElement {
  id: string;
  type: 'text' | 'shape' | 'image';
  style: {
    top: number;
    left: number;
    width: number;
    height: number;
    zIndex: number;
  };
}

// Specific properties for a Text element
export interface TextElement extends CanvasElement {
  type: 'text';
  content: string;
  isEditing?: boolean;
  style: CanvasElement['style'] & {
    
    textAlign: 'left' | 'center' | 'right';
  };
}

// Specific properties for a Shape element
export interface ShapeElement extends CanvasElement {
  type: 'shape';
  style: CanvasElement['style'] & {
    backgroundColor: string;
    borderRadius?: number;
  };
}

// Specific properties for an Image element
export interface ImageElement extends CanvasElement {
  type: 'image';
  src: string; // URL of the image
  style: CanvasElement['style'] & {
    borderRadius?: number;
  };
}

export interface BlockStyles {
  [key: string]: string | number | undefined;
  fontSize?: string;
  color?: string; 
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  fontWeight?: string;
  padding?: string;
  backgroundColor?: string;
  borderRadius?: string;
  border?: string;
  width?: string;
  height?: string;
  margin?: string;
}

export interface EmailBlock {
  id: string;
  type: 'text' | 'image' | 'button' | 'divider' | 'columns' | 'social';
  content: string | { left: string; right: string } | string[];
  styles: BlockStyles;
  link?: string;
  fileName?: string;
}

// A union type that represents any possible element on our canvas
export type AnyCanvasElement = TextElement | ShapeElement | ImageElement;