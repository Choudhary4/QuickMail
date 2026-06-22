import React, { useState, useCallback } from 'react';
import { useWizardStore } from '@/store/wizardStore';
import { EmailBlock } from '@/lib/types'; // Import from shared location
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent, useDraggable, DragOverlay, DragStartEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Type,
  MousePointer as ButtonIcon,
  Minus,
  Grid3X3,
  Share2,
  Smartphone,
  Monitor,
  Download,
  Trash2,
  Copy,
  ImageIcon,
  GripVertical
} from 'lucide-react';

// Import shadcn/ui components
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Assuming your EmailBlock type in @/lib/types has been updated to include `fileName?: string;`

type PreviewMode = 'desktop' | 'mobile';

function SortableBlockItem({ id, children }: { id: string, children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group">
      <div className="relative">
        {children}
        <button
          {...attributes}
          {...listeners}
          className="absolute top-1/2 -left-8 -translate-y-1/2 p-2 bg-gray-200 rounded-md opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-5 h-5 text-gray-600" />
        </button>
      </div>
    </div>
  );
}

interface StylePanelProps {
  selectedBlockId: string;
  setSelectedBlockId: (id: string | null) => void;
  moveBlock: (blockId: string, direction: 'up' | 'down') => void;
}

const StylePanel: React.FC<StylePanelProps> = ({ selectedBlockId, setSelectedBlockId, moveBlock }) => {
  const { emailBlocks, updateEmailBlock, deleteEmailBlock } = useWizardStore();
  const block = emailBlocks.find(b => b.id === selectedBlockId);

  if (!block) return null;

  return (
    <Card className="w-80 h-full overflow-y-auto">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Style Properties</CardTitle>
            <CardDescription>Customize the selected block</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              deleteEmailBlock(block.id);
              setSelectedBlockId(null); // Deselect after deleting
            }}
            className="text-red-600 hover:text-red-700"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
        <Badge variant="secondary" className="w-fit">
          {block.type} block
        </Badge>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Content Editor */}
        <div className="space-y-2">
          <Label htmlFor="content">Content</Label>
          {block.type === 'text' && (
            <Textarea
              id="content"
              value={block.content as string}
              onChange={(e) => updateEmailBlock(block.id, { content: e.target.value })}
              rows={3}
            />
          )}
          {block.type === 'image' && (
            <div className="relative flex items-center">
              <Input
                id="content"
                type="text"
                placeholder="Paste URL or click icon to upload"
                value={
                  block.fileName ||
                  (!(block.content as string)?.startsWith('data:') ? block.content as string : '')
                }
                onChange={(e) => {
                  // Handles manual typing
                  updateEmailBlock(block.id, { content: e.target.value, fileName: undefined });
                }}
                onPaste={(e) => {
                  // Specifically handles pasting to ensure it works reliably
                  const pastedText = e.clipboardData.getData('text');
                  updateEmailBlock(block.id, { content: pastedText, fileName: undefined });
                }}
                className="pr-10"
              />
              <label htmlFor="file-upload" className="absolute right-0 top-0 h-full flex items-center px-3 cursor-pointer text-gray-500 hover:text-gray-700">
                <ImageIcon className="w-5 h-5" />
              </label>
              <input
                id="file-upload"
                type="file"
                className="hidden"
                accept="image/*"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    // Reset input value to allow re-uploading the same file
                    e.target.value = '';
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      updateEmailBlock(block.id, {
                        content: reader.result as string,
                        fileName: file.name,
                      });
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
            </div>
          )}
          {block.type === 'button' && (
            <div className="space-y-2">
              <Input
                type="text"
                value={block.content as string}
                onChange={(e) => updateEmailBlock(block.id, { content: e.target.value })}
              />
              <Input
                type="url"
                value={block.link || ''}
                onChange={(e) => updateEmailBlock(block.id, { link: e.target.value })}
              />
            </div>
          )}
                    {block.type === 'columns' && (
            <div className="space-y-3">
              <Textarea
                value={(block.content as { left: string; right: string }).left}
                onChange={(e) => updateEmailBlock(block.id, { content: { ...(block.content as { left: string; right: string }), left: e.target.value } })}
              />
              <Textarea
                value={(block.content as { left: string; right: string }).right}
                onChange={(e) => updateEmailBlock(block.id, { content: { ...(block.content as { left: string; right: string }), right: e.target.value } })}
              />
            </div>
          )}
        </div>

        <Separator />

        {(block.type === 'text' || block.type === 'button') && (
          <div className="space-y-4">
            <Label className="text-sm font-medium">Typography</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="font-family">Font Family</Label>
                <Select
                  value={block.styles.fontFamily as string}
                  onValueChange={(value) => updateEmailBlock(block.id, { styles: { ...block.styles, fontFamily: value } })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Arial, sans-serif">Arial</SelectItem>
                    <SelectItem value="Georgia, serif">Georgia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="font-size">Font Size (px)</Label>
                <Input
                  id="font-size"
                  type="number"
                  value={parseInt(block.styles.fontSize as string || '16')}
                  onChange={(e) => updateEmailBlock(block.id, { styles: { ...block.styles, fontSize: `${e.target.value}px` } })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="text-color">Text Color</Label>
              <Input
                id="text-color"
                type="color"
                value={block.styles.color as string || '#333333'}
                onChange={(e) => updateEmailBlock(block.id, { styles: { ...block.styles, color: e.target.value } })}
              />
            </div>
          </div>
        )}

        <Separator />

        <div className="space-y-4">
          <Label className="text-sm font-medium">Background & Spacing</Label>
          <div className="space-y-2">
            <Label htmlFor="bg-color">Background Color</Label>
            <Input
              id="bg-color"
              type="color"
              value={block.styles.backgroundColor as string || '#ffffff'}
              onChange={(e) => updateEmailBlock(block.id, { styles: { ...block.styles, backgroundColor: e.target.value } })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="padding">Padding (px)</Label>
            <Input
              id="padding"
              type="number"
              value={parseInt(block.styles.padding as string || '16')}
              onChange={(e) => updateEmailBlock(block.id, { styles: { ...block.styles, padding: `${e.target.value}px` } })}
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label className="text-sm font-medium">Block Actions</Label>
          <div className="flex space-x-2">
            <Button variant="outline" size="sm" onClick={() => moveBlock(block.id, 'up')} className="flex-1">Move Up</Button>
            <Button variant="outline" size="sm" onClick={() => moveBlock(block.id, 'down')} className="flex-1">Move Down</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

function DraggableSidebarItem({ component }: { component: typeof componentLibrary[0] }) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: component.id,
    data: { isSidebarComponent: true }
  });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}>
      <Card className="cursor-grab hover:shadow-md transition-shadow">
        <CardContent className="p-4 flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${component.color}`}><component.icon className="w-5 h-5 text-white" /></div>
          <div>
            <h3 className="font-medium text-sm">{component.label}</h3>
            <p className="text-xs text-gray-500">{component.description}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const componentLibrary = [
  { id: 'text', icon: Type, label: 'Text Block', color: 'bg-blue-500', description: 'Add headings, paragraphs' },
  { id: 'image', icon: ImageIcon, label: 'Image Block', color: 'bg-green-500', description: 'Insert images' },
  { id: 'button', icon: ButtonIcon, label: 'Button', color: 'bg-purple-500', description: 'Call-to-action button' },
  { id: 'divider', icon: Minus, label: 'Divider', color: 'bg-gray-500', description: 'Horizontal line' },
  { id: 'columns', icon: Grid3X3, label: '2 Columns', color: 'bg-orange-500', description: 'Split layout' },
  { id: 'social', icon: Share2, label: 'Social Icons', color: 'bg-pink-500', description: 'Social media links' },
];

const defaultStyles = {
  text: { fontSize: '16px', color: '#333333', fontFamily: 'Arial, sans-serif', textAlign: 'left', fontWeight: 'normal', padding: '16px', backgroundColor: 'transparent' },
  image: { width: '100%', padding: '16px' },
  button: { backgroundColor: '#3b82f6', color: '#ffffff', padding: '12px 24px', borderRadius: '6px', fontSize: '16px', textAlign: 'center', margin: '16px auto', border: 'none' },
  divider: { height: '1px', backgroundColor: '#e5e7eb', margin: '20px 0', border: 'none' },
  columns: {}, social: {},
}as const;

const EmailBuilder: React.FC = () => {
  const { emailBlocks, setEmailBlocks } = useWizardStore();
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('desktop');
  const [showHTMLOutput, setShowHTMLOutput] = useState<boolean>(false);
  const [generatedHTML, setGeneratedHTML] = useState<string>('');
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const getDefaultContent = (type: EmailBlock['type']): EmailBlock['content'] => {
    switch (type) {
      case 'text': return 'Click to edit this text.';
      case 'image': return '/image.png';
      case 'button': return 'Click Here';
      case 'divider': return '';
      case 'columns': return { left: 'Left column content goes here.', right: 'Right column content goes here.' };
      case 'social': return ['facebook', 'twitter', 'linkedin'];
      default: return '';
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over) return;

    if (active.data.current?.isSidebarComponent) {
      const newBlock: EmailBlock = {
        id: `${active.id}-${Date.now()}`,
        type: active.id as EmailBlock['type'],
        content: getDefaultContent(active.id as EmailBlock['type']),
        styles: defaultStyles[active.id as keyof typeof defaultStyles] ? { ...defaultStyles[active.id as keyof typeof defaultStyles] } : {},
      };

      const overIndex = emailBlocks.findIndex(b => b.id === over.id);
      if (overIndex !== -1) {
        const newBlocks = [...emailBlocks];
        newBlocks.splice(overIndex, 0, newBlock);
        setEmailBlocks(newBlocks);
      } else {
        setEmailBlocks([...emailBlocks, newBlock]);
      }
      setSelectedBlockId(newBlock.id);
      return;
    }

    if (active.id !== over.id) {
      const oldIndex = emailBlocks.findIndex((b) => b.id === active.id);
      const newIndex = emailBlocks.findIndex((b) => b.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setEmailBlocks(arrayMove(emailBlocks, oldIndex, newIndex));
      }
    }
  };

  const handleAddNewBlock = useCallback((type: EmailBlock['type']) => {
    const newBlock: EmailBlock = {
      id: `${type}-${Date.now()}`,
      type,
      content: getDefaultContent(type),
      styles: defaultStyles[type as keyof typeof defaultStyles] ? { ...defaultStyles[type as keyof typeof defaultStyles] } : {},
    };
    setEmailBlocks([...emailBlocks, newBlock]);
    setSelectedBlockId(newBlock.id);
  }, [emailBlocks, setEmailBlocks]);

  const moveBlock = useCallback((blockId: string, direction: 'up' | 'down') => {
    const index = emailBlocks.findIndex(block => block.id === blockId);
    if (index === -1) return;
    if (direction === 'up' && index > 0) setEmailBlocks(arrayMove(emailBlocks, index, index - 1));
    if (direction === 'down' && index < emailBlocks.length - 1) setEmailBlocks(arrayMove(emailBlocks, index, index + 1));
  }, [emailBlocks, setEmailBlocks]);

  const generateHTML = (): string => {
    const emailHTML = `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Email Template</title>
        <style>
            body { margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5; }
            .email-container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
            .responsive-img { max-width: 100%; height: auto; display: block; }
            @media only screen and (max-width: 600px) {
                .email-container { width: 100% !important; }
                .mobile-padding { padding: 10px !important; }
                .column { width: 100% !important; display: block !important; }
            }
        </style>
    </head>
    <body>
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
                <td style="background-color: #f5f5f5;">
                    <div class="email-container">
                        ${emailBlocks.map(block => generateBlockHTML(block)).join('')}
                    </div>
                </td>
            </tr>
        </table>
    </body>
    </html>`;
    return emailHTML;
  };

  const generateBlockHTML = (block: EmailBlock): string => {
    const styleString = Object.entries(block.styles || {})
      .map(([key, value]) => `${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${value}`)
      .join('; ');

    switch (block.type) {
      case 'text':
        return `<div style="${styleString}">${(block.content as string).replace(/\n/g, '<br>')}</div>`;
      case 'image':
        return `<div style="text-align: center; ${block.styles.padding ? `padding: ${block.styles.padding};` : ''}">
              <img src="${block.content as string}" style="${styleString}" class="responsive-img" alt="Email Image" />
            </div>`;
      case 'button':
        const buttonLink = block.link || '#';
        return `<div style="text-align: center; padding: 20px;">
              <a href="${buttonLink}" style="${styleString}; text-decoration: none; display: inline-block;">${block.content as string}</a>
            </div>`;
      case 'divider':
        return `<hr style="${styleString}" />`;
      case 'columns':
        const columnContent = block.content as { left: string; right: string };
        return `<table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
              <tr>
                <td width="50%" style="padding: 15px; vertical-align: top;" class="column">${columnContent.left}</td>
                <td width="50%" style="padding: 15px; vertical-align: top;" class="column">${columnContent.right}</td>
              </tr>
            </table>`;
      case 'social':
        const socialLinks = block.content as string[];
        return `<div style="text-align: center; padding: 30px;">
              ${socialLinks.map(social =>
          `<a href="#" style="display: inline-block; margin: 0 8px;">
                  <img src="https://img.icons8.com/color/48/000000/${social}.png" alt="${social}" style="width: 24px; height: 24px;" />
                </a>`
        ).join('')}
            </div>`;
      default:
        return '';
    }
  };

  const exportHTML = () => {
    const html = generateHTML();
    setGeneratedHTML(html);
    setShowHTMLOutput(true);
  };

  const copyHTMLToClipboard = () => {
    navigator.clipboard.writeText(generatedHTML);
  };

  const downloadHTML = () => {
    const blob = new Blob([generatedHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'email-template.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDragId(null)}
    >
      <div className="flex h-screen bg-gray-50">
        <div className="w-72 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="p-6">
            <h2 className="text-xl font-bold mb-6">Components</h2>
            <div className="space-y-3">
              {componentLibrary.map(component => (
                <DraggableSidebarItem key={component.id} component={component} />
              ))}
            </div>
            <Separator className="my-6" />
            <div>
              <h3 className="font-semibold mb-3">Quick Templates</h3>
              <Button variant="outline" size="sm" onClick={() => {
                setEmailBlocks([]);
                handleAddNewBlock('text');
                handleAddNewBlock('image');
                handleAddNewBlock('button');
              }} className="w-full justify-start">
                Newsletter
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col">
          <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h1 className="text-2xl font-bold">Email Builder</h1>
            <div className="flex items-center space-x-4">
              <Tabs value={previewMode} onValueChange={(value) => setPreviewMode(value as PreviewMode)}>
                <TabsList>
                  <TabsTrigger value="desktop"><Monitor className="w-4 h-4 mr-2" />Desktop</TabsTrigger>
                  <TabsTrigger value="mobile"><Smartphone className="w-4 h-4 mr-2" />Mobile</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button onClick={exportHTML}><Download className="w-4 h-4 mr-2" />Export HTML</Button>
            </div>
          </div>

          <div className="flex-1 p-8 overflow-auto bg-gray-100">
            <div className={`mx-auto bg-white shadow-lg ${previewMode === 'mobile' ? 'max-w-sm' : 'max-w-2xl'}`}>
              <SortableContext items={emailBlocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                <div className="p-4 space-y-2 min-h-[400px]"> {/* min-h to ensure drop zone exists when empty */}
                  {emailBlocks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center p-4">
                      <h3 className="text-xl font-medium mb-2">Drag and Drop a Component Here</h3>
                      <p className="text-gray-500">Start building your email by dragging a component from the left sidebar.</p>
                    </div>
                  ) : (
                    emailBlocks.map((block) => (
                      <SortableBlockItem key={block.id} id={block.id}>
                        <div
                          onClick={() => setSelectedBlockId(block.id)}
                          className={`cursor-pointer transition-all ${selectedBlockId === block.id
                              ? 'ring-2 ring-blue-500'
                              : 'hover:ring-1 hover:ring-gray-300'
                            }`}
                        >
                          {block.type === 'text' && <div style={block.styles} dangerouslySetInnerHTML={{ __html: (block.content as string).replace(/\n/g, '<br>') }} />}
                          {block.type === 'image' && <div style={{ textAlign: 'center', padding: block.styles.padding }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={block.content as string} alt="Email Image" style={{ ...block.styles, maxWidth: '100%', height: 'auto' }} />
                          </div>}
                          {block.type === 'button' && <div style={{ textAlign: 'center', padding: '20px' }}><a href={block.link || '#'} style={{ ...block.styles, textDecoration: 'none', display: 'inline-block' }}>{block.content as string}</a></div>}
                          {block.type === 'divider' && <hr style={block.styles} />}
                          {block.type === 'columns' && <div style={{ display: 'flex', gap: '10px', padding: '10px' }}><div style={{ flex: 1, border: '1px dashed #ccc', padding: '10px' }}>{(block.content as { left: string; right: string }).left}</div><div style={{ flex: 1, border: '1px dashed #ccc', padding: '10px' }}>{(block.content as { left: string; right: string }).right}</div></div>}
                          {block.type === 'social' && <div style={{ textAlign: 'center', padding: '20px', display: 'flex', justifyContent: 'center', gap: '10px' }}>{(block.content as string[]).map(s => <Share2 key={s} />)}</div>}
                        </div>
                      </SortableBlockItem>
                    ))
                  )}
                </div>
              </SortableContext>
            </div>
          </div>
        </div>

        {selectedBlockId && <StylePanel selectedBlockId={selectedBlockId} setSelectedBlockId={setSelectedBlockId} moveBlock={moveBlock} />}
      </div>

      <DragOverlay>
        {activeDragId ? (
          (() => {
            const sidebarComponent = componentLibrary.find(c => c.id === activeDragId);
            if (sidebarComponent) {
              return (
                <Card>
                  <CardContent className="p-4 flex items-center space-x-3 bg-white shadow-lg rounded-lg">
                    <div className={`p-2 rounded-lg ${sidebarComponent.color}`}><sidebarComponent.icon className="w-5 h-5 text-white" /></div>
                    <div>
                      <h3 className="font-medium text-sm">{sidebarComponent.label}</h3>
                    </div>
                  </CardContent>
                </Card>
              );
            }

            const activeBlock = emailBlocks.find(b => b.id === activeDragId);
            if (activeBlock) {
              return (
                <div className="bg-white p-4 shadow-lg rounded-lg opacity-90">
                  {activeBlock.type === 'text' && <div style={activeBlock.styles}>{(activeBlock.content as string).substring(0, 50)}...</div>}
                  {activeBlock.type === 'image' && 
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={activeBlock.content as string} alt="Preview" style={{ width: '150px' }} />
                  }
                  {activeBlock.type === 'button' && <Button style={activeBlock.styles}>{activeBlock.content as string}</Button>}
                  {/* Add other block type previews as needed */}
                </div>
              );
            }

            return null;
          })()
        ) : null}
      </DragOverlay>

      <Dialog open={showHTMLOutput} onOpenChange={setShowHTMLOutput}>
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader><DialogTitle>Generated HTML Code</DialogTitle></DialogHeader>
          <div className="flex space-x-2">
            <Button onClick={copyHTMLToClipboard} variant="outline"><Copy className="w-4 h-4 mr-2" />Copy HTML</Button>
            <Button onClick={downloadHTML}><Download className="w-4 h-4 mr-2" />Download File</Button>
          </div>
          <div className="flex-1 bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto">
            <pre className="text-sm"><code>{generatedHTML}</code></pre>
          </div>
        </DialogContent>
      </Dialog>
    </DndContext>
  );
};

export default EmailBuilder;