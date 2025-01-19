import { BaseAPIClient } from './base.js';
import type {
    CrawlRequest,
    CrawlResult,
    SpiderOptions,
    PageOptions,
    PluginOptions,
    CrawlEvent,
    CreateCrawlRequest
} from './types.js';
import axios from 'axios'; // Add axios import

export * from './types.js';

export class WaterCrawlAPIClient extends BaseAPIClient {
    async getCrawlRequestsList(page?: number, pageSize?: number): Promise<{ results: CrawlRequest[] }> {
        return this.get('/api/v1/core/crawl-requests/', { page, page_size: pageSize });
    }

    async getCrawlRequest(itemId: string): Promise<CrawlRequest> {
        return this.get(`/api/v1/core/crawl-requests/${itemId}/`);
    }

    async createCrawlRequest(
        url: string,
        spiderOptions: SpiderOptions = {},
        pageOptions: PageOptions = {},
        pluginOptions: PluginOptions = {}
    ): Promise<CrawlRequest> {
        const request: CreateCrawlRequest = {
            url,
            options: {
                spider_options: spiderOptions,
                page_options: pageOptions,
                plugin_options: pluginOptions
            }
        };
        return this.post('/api/v1/core/crawl-requests/', request);
    }

    async stopCrawlRequest(itemId: string): Promise<null> {
        return this.delete(`/api/v1/core/crawl-requests/${itemId}/`);
    }

    async downloadCrawlRequest(itemId: string): Promise<CrawlResult[]> {
        return this.get(`/api/v1/core/crawl-requests/${itemId}/download/`);
    }

    async *monitorCrawlRequest(itemId: string, download: boolean = true): AsyncGenerator<CrawlEvent, void, unknown> {
        const events: CrawlEvent[] = [];
        let resolveNext: ((value: IteratorResult<CrawlEvent, void>) => void) | null = null;
        let isDone = false;
        let streamError: Error | null = null;

        const processEvent = (event: CrawlEvent) => {
            if (resolveNext) {
                resolveNext({ value: event, done: false });
                resolveNext = null;
            } else {
                events.push(event);
            }
        };

        const streamPromise = this.streamEvents(
            `/api/v1/core/crawl-requests/${itemId}/status/`,
            processEvent,
            { params: { download } }
        ).catch((error) => {
            streamError = error;
            isDone = true;
        }).finally(() => {
            isDone = true;
        });
    

        try {
            while (!isDone || events.length > 0) {
                if (events.length > 0) {
                    yield events.shift()!;
                } else if (!isDone) {
                    await new Promise<IteratorResult<CrawlEvent, void>>((resolve) => {
                        resolveNext = resolve;
                    });
                }
            }
    
            // Check for any remaining events after the stream ends
            while (events.length > 0) {
                yield events.shift()!;
            }
    
            // If the stream failed, propagate the error
            if (streamError) {
                throw streamError;
            }
        } finally {
            // Ensure the stream is awaited and cleaned up properly
            await streamPromise;
        }
    }

    async getCrawlRequestResults(itemId: string): Promise<{ results: CrawlResult[] }> {
        return this.get(`/api/v1/core/crawl-requests/${itemId}/results/`);
    }

    async downloadResult(resultObject: CrawlResult): Promise<Record<string, any>> {
        const response = await axios.get(resultObject.result);
        return response.data;
    }

    async scrapeUrl(
        url: string,
        pageOptions: PageOptions = {},
        pluginOptions: PluginOptions = {},
        sync: boolean = true,
        download: boolean = true
    ): Promise<Record<string, any> | CrawlRequest> {
        const request = await this.createCrawlRequest(url, {}, pageOptions, pluginOptions);

        if (!sync) {
            return request;
        }

        for await (const event of this.monitorCrawlRequest(request.uuid, download)) {
            if (event.type === 'result') {
                return event.data as CrawlResult;
            }
        }

        throw new Error('No result received from crawl');
    }
}
