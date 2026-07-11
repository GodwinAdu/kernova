/**
 * Built-in Tool: image-describe
 *
 * Sends an image (URL or base64 data URI) to a vision-capable model
 * and returns a textual description. Uses the kernel's ModelRouter
 * to route the request to an appropriate provider.
 */

import type { ToolDefinition } from '../plugins/plugin-registry.js';
import type { ModelRouter } from '../models/model-router.js';

export function createImageDescribeTool(modelRouter: ModelRouter): ToolDefinition {
  return {
    id: 'image-describe',
    name: 'Image Describe',
    description:
      'Describe an image using a vision-capable AI model. Accepts an image URL or base64 data URI.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Image URL (https://...) or base64 data URI (data:image/...;base64,...)',
        },
        prompt: {
          type: 'string',
          description: 'What to focus on when describing the image (default: "Describe this image in detail")',
        },
      },
      required: ['url'],
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const url = params.url as string;
      const prompt = (params.prompt as string) || 'Describe this image in detail';

      if (!url) {
        return {
          error: true,
          message: 'Image URL is required',
        };
      }

      // Validate URL format
      const isDataUri = url.startsWith('data:image/');
      const isHttpUrl = url.startsWith('http://') || url.startsWith('https://');

      if (!isDataUri && !isHttpUrl) {
        return {
          error: true,
          message: 'Invalid image URL. Must be an HTTP(S) URL or a base64 data URI (data:image/...)',
        };
      }

      try {
        const response = await modelRouter.complete(
          {
            model: '',
            messages: [
              {
                role: 'user',
                content: prompt,
                parts: [
                  { type: 'text', text: prompt },
                  { type: 'image', url },
                ],
              },
            ],
            maxTokens: 1024,
            metadata: {
              purpose: 'vision',
            },
          },
          'vision',
        );

        return {
          description: response.content,
          url,
        };
      } catch (err) {
        return {
          error: true,
          message: `Image description failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
