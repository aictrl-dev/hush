import blessed from 'blessed';
import contrib from 'blessed-contrib';

/**
 * hush 🛡️ Dashboard v2 - Terminal Edition
 * Aligned with the official brand book and dashboard mockup.
 */
export class Dashboard {
  private screen: blessed.Widgets.Screen;
  private grid: contrib.grid;
  
  // Components
  private log: any;
  private piiBreakdown: any;
  private vaultGauge: any;
  private latencySpark: any;
  
  // Hero Stats (Boxes)
  private statBoxes: {
    protection: any;
    piiCount: any;
    activePatterns: any;
    leakCount: any;
  };

  // State
  private stats = {
    redactedCount: 0,
    requestCount: 0,
    leaks: 0,
    types: new Map<string, number>(),
    latency: [] as number[],
  };

  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'hush 🛡️ | Semantic Security Gateway'
    });

    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    // --- ROW 1: HERO STATS (0-2) ---
    this.statBoxes = {
      protection: this.grid.set(0, 0, 2, 3, blessed.box, {
        label: ' PROTECTION ',
        content: '{center}{green-fg}ACTIVE{/green-fg}{/center}\n{center}127.0.0.1:4000{/center}',
        tags: true,
        border: { type: 'line', fg: 'green' }
      }),
      piiCount: this.grid.set(0, 3, 2, 3, blessed.box, {
        label: ' PII PROTECTED ',
        content: '{center}{bold}0{/bold}{/center}',
        tags: true,
        border: { type: 'line', fg: 'blue' }
      }),
      activePatterns: this.grid.set(0, 6, 2, 3, blessed.box, {
        label: ' PATTERNS ',
        content: '{center}{bold}6{/bold}{/center}',
        tags: true,
        border: { type: 'line', fg: 'yellow' }
      }),
      leakCount: this.grid.set(0, 9, 2, 3, blessed.box, {
        label: ' LEAKS ',
        content: '{center}{bold}0{/bold}{/center}',
        tags: true,
        border: { type: 'line', fg: 'white' }
      })
    };

    // --- ROW 2: LIVE FEED & TYPE BREAKDOWN (2-9) ---
    this.log = this.grid.set(2, 0, 7, 8, contrib.log, {
      fg: 'green',
      selectedFg: 'green',
      label: ' Live Redaction Feed ',
      border: { type: 'line', fg: 'cyan' }
    });

    this.piiBreakdown = this.grid.set(2, 8, 7, 4, contrib.bar, {
      label: ' PII by Type ',
      barWidth: 4,
      barSpacing: 6,
      xOffset: 0,
      maxHeight: 10,
    });

    // --- ROW 3: VAULT & LATENCY (9-12) ---
    this.vaultGauge = this.grid.set(9, 0, 3, 4, contrib.gauge, {
      label: ' Vault Capacity ',
      percent: [0],
    });

    this.latencySpark = this.grid.set(9, 4, 3, 8, contrib.sparkline, {
      label: ' Redaction Latency (ms) ',
      tags: true,
      style: { fg: 'blue' }
    });

    // Quit keys
    this.screen.key(['escape', 'q', 'C-c'], () => {
      return process.exit(0);
    });

    this.render();
  }

  public logRedaction(type: string, token: string) {
    this.stats.redactedCount++;
    this.stats.types.set(type, (this.stats.types.get(type) || 0) + 1);
    
    // Log entry with color highlighting
    const typeColor = this.getTypeColor(type);
    this.log.log(`{${typeColor}-fg}${type.padEnd(5)}{/${typeColor}-fg} | {grey-fg}PROTECTED{/grey-fg} → {white-fg}${token}{/white-fg}`);
    
    this.updateUI();
  }

  public logRequest(path: string, durationMs: number = 0) {
    this.stats.requestCount++;
    if (durationMs > 0) {
      this.stats.latency.push(durationMs);
      if (this.stats.latency.length > 50) this.stats.latency.shift();
    }
    this.updateUI();
  }

  private getTypeColor(type: string): string {
    const colors: Record<string, string> = {
      'EML': 'blue',
      'IP4': 'yellow',
      'SEC': 'red',
      'CC': 'magenta',
      'PHN': 'green'
    };
    return colors[type] || 'white';
  }

  private updateUI() {
    // Update Stat Boxes
    this.statBoxes.piiCount.setContent(`{center}{bold}${this.stats.redactedCount}{/bold}{/center}`);
    this.statBoxes.protection.setContent(`{center}{green-fg}ACTIVE{/green-fg}{/center}\n{center}${this.stats.requestCount} REQS{/center}`);

    // Update Breakdown Bar Chart
    const barData = {
      titles: Array.from(this.stats.types.keys()),
      data: Array.from(this.stats.types.values())
    };
    if (barData.titles.length > 0) {
      this.piiBreakdown.setData(barData);
    }

    // Update Latency Sparkline
    if (this.stats.latency.length > 0) {
      this.latencySpark.setData(['Latency'], [this.stats.latency]);
    }

    // Update Vault Gauge (Simulated/Placeholder for now)
    const vaultPercent = Math.min(100, Math.round((this.stats.redactedCount / 1000) * 100));
    this.vaultGauge.setData([vaultPercent]);

    this.render();
  }

  private render() {
    this.screen.render();
  }

  /**
   * Get current dashboard statistics (for testing and programmatic access).
   */
  public getStats() {
    return {
      redactedCount: this.stats.redactedCount,
      requestCount: this.stats.requestCount,
      leaks: this.stats.leaks,
      types: new Map(this.stats.types),
      latency: [...this.stats.latency],
    };
  }
}
