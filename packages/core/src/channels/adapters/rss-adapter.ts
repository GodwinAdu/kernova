/**
 * RSS/Atom Feed Monitor Adapter
 *
 * Connects Kernova to RSS/Atom feeds for monitoring.
 * This is a receive-only adapter — RSS doesn't support outbound messages.
 * Polls configured feeds at an interval and emits new items as messages.
 */

import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, RssConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';

const DEFAULT_POLL_INTERVAL = 300_000; // 5 minutes

export class RssAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'rss';
  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private seenGuids: Set<string> = new Set();

  constructor(private config: RssConfig) {}

  get state(): ConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') return;
    this.setState('connecting');

    try {
      if (!this.config.feeds.length) {
        throw new Error('At least one feed URL is required');
      }

      // Verify at least one feed is accessible
      const firstFeed = this.config.feeds[0];
      const res = await fetch(firstFeed.url);
      if (!res.ok) {
        throw new Error(`Feed ${firstFeed.url} returned ${res.status}`);
      }

      this.setState('connected');

      // Start polling
      const interval = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
      this.pollTimer = setInterval(() => this.pollFeeds(), interval);
      this.pollFeeds(); // first poll immediately
    } catch (err) {
      this.setState('failed');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.setState('disconnected');
  }

  async send(_message: OutboundMessage): Promise<DeliveryReceipt> {
    // RSS is receive-only
    return {
      success: false,
      timestamp: now(),
      error: 'RSS adapter is receive-only — outbound messages are not supported',
    };
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateHandler = handler;
  }

  // ─── Feed Polling ───────────────────────────────────────────

  private async pollFeeds(): Promise<void> {
    for (const feed of this.config.feeds) {
      try {
        const res = await fetch(feed.url);
        if (!res.ok) continue;

        const xml = await res.text();
        const items = this.parseItems(xml);

        for (const item of items) {
          const guid = item.guid ?? item.link ?? `${item.title}_${feed.url}`;
          if (this.seenGuids.has(guid)) continue;

          this.seenGuids.add(guid);
          this.messageHandler?.({
            sender: feed.name,
            content: this.formatItem(item),
            timestamp: item.pubDate ?? now(),
            raw: { feed: feed.url, ...item },
          });
        }
      } catch {
        // Non-fatal — continue to next feed
      }
    }

    // Cap seenGuids to prevent unbounded growth
    if (this.seenGuids.size > 10_000) {
      const entries = [...this.seenGuids];
      this.seenGuids = new Set(entries.slice(-5_000));
    }
  }

  // ─── XML Parsing ────────────────────────────────────────────

  private parseItems(xml: string): RssItem[] {
    const items: RssItem[] = [];

    // Match RSS <item> elements or Atom <entry> elements
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null) {
      const content = match[1] ?? match[2];
      if (!content) continue;

      const title = this.extractTag(content, 'title');
      const link = this.extractTag(content, 'link') ?? this.extractAtomLink(content);
      const description = this.extractTag(content, 'description') ?? this.extractTag(content, 'summary');
      const guid = this.extractTag(content, 'guid') ?? this.extractTag(content, 'id');
      const pubDate = this.extractTag(content, 'pubDate') ?? this.extractTag(content, 'published');

      items.push({ title, link, description, guid, pubDate });
    }

    return items;
  }

  private extractTag(xml: string, tag: string): string | undefined {
    // Handle both <tag>content</tag> and <tag><![CDATA[content]]></tag>
    const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
    const match = xml.match(regex);
    return match?.[1]?.trim() || undefined;
  }

  private extractAtomLink(xml: string): string | undefined {
    // Atom links: <link href="..." />
    const match = xml.match(/<link[^>]+href="([^"]+)"/i);
    return match?.[1] || undefined;
  }

  private formatItem(item: RssItem): string {
    const parts: string[] = [];
    if (item.title) parts.push(item.title);
    if (item.description) parts.push(item.description);
    if (item.link) parts.push(item.link);
    return parts.join('\n') || '(empty item)';
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.stateHandler?.(state);
  }
}

interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  guid?: string;
  pubDate?: string;
}
