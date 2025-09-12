/**
 * Advanced ANSI Escape Sequence Renderer
 * Converts ANSI escape sequences to HTML with proper styling
 * Specifically optimized for Claude Code CLI output
 */

// ANSI Color Constants
const ANSI_COLORS = {
  // Standard colors (3/4-bit)
  basic: {
    30: '#000000', // Black
    31: '#ff5f5f', // Red
    32: '#5fff5f', // Green
    33: '#ffff5f', // Yellow
    34: '#5f5fff', // Blue
    35: '#ff5fff', // Magenta
    36: '#5fffff', // Cyan
    37: '#ffffff', // White
    
    // Bright colors
    90: '#808080', // Bright Black (Gray)
    91: '#ff8080', // Bright Red
    92: '#80ff80', // Bright Green
    93: '#ffff80', // Bright Yellow
    94: '#8080ff', // Bright Blue
    95: '#ff80ff', // Bright Magenta
    96: '#80ffff', // Bright Cyan
    97: '#ffffff', // Bright White
  },
  
  // Background colors
  bg: {
    40: '#000000', 41: '#ff5f5f', 42: '#5fff5f', 43: '#ffff5f',
    44: '#5f5fff', 45: '#ff5fff', 46: '#5fffff', 47: '#ffffff',
    100: '#808080', 101: '#ff8080', 102: '#80ff80', 103: '#ffff80',
    104: '#8080ff', 105: '#ff80ff', 106: '#80ffff', 107: '#ffffff'
  }
};

// Claude Code specific color theme
const CLAUDE_THEME = {
  // Primary Claude colors
  primary: '#667eea',
  secondary: '#764ba2',
  accent: '#f093fb',
  
  // Status colors
  success: '#28a745',
  error: '#dc3545', 
  warning: '#ffc107',
  info: '#17a2b8',
  
  // Text colors for dark theme
  text: {
    primary: '#e1e1e1',
    secondary: '#94a3b8',
    muted: '#6c757d',
    claude: '#c9cbff',
    user: '#89b4fa',
    system: '#94a3b8'
  },
  
  // Background colors
  bg: {
    primary: '#0f0f23',
    secondary: '#1a1a2e',
    tertiary: '#2a2a3e'
  }
};

// 256-color palette (xterm colors)
function generate256ColorPalette() {
  const colors = new Array(256);
  
  // Colors 0-15: basic colors
  colors[0] = '#000000'; colors[1] = '#800000'; colors[2] = '#008000'; colors[3] = '#808000';
  colors[4] = '#000080'; colors[5] = '#800080'; colors[6] = '#008080'; colors[7] = '#c0c0c0';
  colors[8] = '#808080'; colors[9] = '#ff0000'; colors[10] = '#00ff00'; colors[11] = '#ffff00';
  colors[12] = '#0000ff'; colors[13] = '#ff00ff'; colors[14] = '#00ffff'; colors[15] = '#ffffff';
  
  // Colors 16-231: 216-color cube (6x6x6)
  for (let i = 0; i < 216; i++) {
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    
    const toHex = (val) => {
      const values = [0, 95, 135, 175, 215, 255];
      return values[val].toString(16).padStart(2, '0');
    };
    
    colors[16 + i] = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  
  // Colors 232-255: grayscale
  for (let i = 0; i < 24; i++) {
    const gray = 8 + i * 10;
    const hex = gray.toString(16).padStart(2, '0');
    colors[232 + i] = `#${hex}${hex}${hex}`;
  }
  
  return colors;
}

const XTERM_COLORS = generate256ColorPalette();

class AnsiRenderer {
  constructor() {
    this.currentStyles = {
      color: null,
      backgroundColor: null,
      bold: false,
      dim: false,
      italic: false,
      underline: false,
      strikethrough: false,
      blink: false,
      reverse: false,
      hidden: false
    };
  }

  /**
   * Parse ANSI escape sequences and convert to HTML
   * @param {string} text - Raw text with ANSI codes
   * @returns {string} HTML with proper styling
   */
  render(text) {
    if (!text) return '';
    
    // Split text by ANSI escape sequences
    const parts = text.split(/(\x1b\[[0-9;]*m)/g);
    let html = '';
    
    for (const part of parts) {
      if (part.startsWith('\x1b[') && part.endsWith('m')) {
        // This is an ANSI escape sequence
        this.parseAnsiCode(part);
      } else if (part.length > 0) {
        // This is regular text, apply current styles
        html += this.wrapWithStyles(this.escapeHtml(part));
      }
    }
    
    return html;
  }

  /**
   * Parse complex ANSI sequences including cursor positioning and other commands
   * @param {string} text - Raw text with all ANSI codes
   * @returns {string} Cleaned text with color rendering
   */
  renderAdvanced(text) {
    if (!text) return '';
    
    let result = text;
    
    // Handle cursor positioning and clear commands
    result = result
      // Cursor positioning (ignore for web terminal)
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[\d;]*[HfABCDEFGJKST]/g, '')
      // Clear screen/line commands (convert to line breaks)
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[2J/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[K/g, '')
      // Private mode sequences
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[\?[\d;]*[hlc]/g, '')
      // Title/icon sequences
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][0-2];[^\x07]*\x07/g, '')
      // Bell character
      // eslint-disable-next-line no-control-regex
      .replace(/\x07/g, '')
      // Backspace handling
      // eslint-disable-next-line no-control-regex
      .replace(/\x08+/g, '');
    
    // Now render colors
    return this.render(result);
  }

  /**
   * Parse a single ANSI escape sequence
   * @param {string} code - ANSI escape sequence (e.g., '\x1b[31m')
   */
  parseAnsiCode(code) {
    // Extract numbers from the code
    const numbers = code.slice(2, -1).split(';').map(n => parseInt(n) || 0);
    
    for (let i = 0; i < numbers.length; i++) {
      const num = numbers[i];
      
      switch (num) {
        case 0: // Reset
          this.resetStyles();
          break;
        case 1: // Bold
          this.currentStyles.bold = true;
          break;
        case 2: // Dim
          this.currentStyles.dim = true;
          break;
        case 3: // Italic
          this.currentStyles.italic = true;
          break;
        case 4: // Underline
          this.currentStyles.underline = true;
          break;
        case 5: // Slow blink
        case 6: // Fast blink
          this.currentStyles.blink = true;
          break;
        case 7: // Reverse
          this.currentStyles.reverse = true;
          break;
        case 8: // Hidden
          this.currentStyles.hidden = true;
          break;
        case 9: // Strikethrough
          this.currentStyles.strikethrough = true;
          break;
        case 22: // Normal intensity
          this.currentStyles.bold = false;
          this.currentStyles.dim = false;
          break;
        case 23: // Not italic
          this.currentStyles.italic = false;
          break;
        case 24: // No underline
          this.currentStyles.underline = false;
          break;
        case 25: // No blink
          this.currentStyles.blink = false;
          break;
        case 27: // No reverse
          this.currentStyles.reverse = false;
          break;
        case 28: // Not hidden
          this.currentStyles.hidden = false;
          break;
        case 29: // No strikethrough
          this.currentStyles.strikethrough = false;
          break;
        case 39: // Default foreground
          this.currentStyles.color = null;
          break;
        case 49: // Default background
          this.currentStyles.backgroundColor = null;
          break;
        default:
          this.handleColorCode(num, numbers, i);
          break;
      }
    }
  }

  /**
   * Handle color-specific ANSI codes
   * @param {number} num - Current number
   * @param {Array} numbers - All numbers in the sequence
   * @param {number} index - Current index
   */
  handleColorCode(num, numbers, index) {
    // Foreground colors (30-37, 90-97)
    if ((num >= 30 && num <= 37) || (num >= 90 && num <= 97)) {
      this.currentStyles.color = ANSI_COLORS.basic[num];
    }
    // Background colors (40-47, 100-107) 
    else if ((num >= 40 && num <= 47) || (num >= 100 && num <= 107)) {
      this.currentStyles.backgroundColor = ANSI_COLORS.bg[num];
    }
    // Extended colors (38 for foreground, 48 for background)
    else if (num === 38 || num === 48) {
      const isBackground = num === 48;
      const nextNum = numbers[index + 1];
      
      if (nextNum === 5) {
        // 256-color mode: ESC[38;5;{n}m or ESC[48;5;{n}m
        const colorIndex = numbers[index + 2];
        if (colorIndex !== undefined && colorIndex >= 0 && colorIndex <= 255) {
          const color = XTERM_COLORS[colorIndex];
          if (isBackground) {
            this.currentStyles.backgroundColor = color;
          } else {
            this.currentStyles.color = color;
          }
        }
      } else if (nextNum === 2) {
        // True color mode: ESC[38;2;{r};{g};{b}m or ESC[48;2;{r};{g};{b}m
        const r = numbers[index + 2];
        const g = numbers[index + 3];
        const b = numbers[index + 4];
        if (r !== undefined && g !== undefined && b !== undefined) {
          const color = `rgb(${r}, ${g}, ${b})`;
          if (isBackground) {
            this.currentStyles.backgroundColor = color;
          } else {
            this.currentStyles.color = color;
          }
        }
      }
    }
  }

  /**
   * Reset all styles to default
   */
  resetStyles() {
    this.currentStyles = {
      color: null,
      backgroundColor: null,
      bold: false,
      dim: false,
      italic: false,
      underline: false,
      strikethrough: false,
      blink: false,
      reverse: false,
      hidden: false
    };
  }

  /**
   * Wrap text with current styles
   * @param {string} text - Text to wrap
   * @returns {string} HTML with styles applied
   */
  wrapWithStyles(text) {
    if (this.currentStyles.hidden) {
      return '';
    }

    const styles = [];
    let classes = [];

    // Color styles
    if (this.currentStyles.color) {
      styles.push(`color: ${this.currentStyles.color}`);
    }
    if (this.currentStyles.backgroundColor) {
      styles.push(`background-color: ${this.currentStyles.backgroundColor}`);
    }

    // Text formatting
    if (this.currentStyles.bold) {
      styles.push('font-weight: bold');
    }
    if (this.currentStyles.dim) {
      styles.push('opacity: 0.6');
    }
    if (this.currentStyles.italic) {
      styles.push('font-style: italic');
    }
    if (this.currentStyles.underline) {
      styles.push('text-decoration: underline');
    }
    if (this.currentStyles.strikethrough) {
      styles.push('text-decoration: line-through');
    }
    if (this.currentStyles.blink) {
      classes.push('ansi-blink');
    }
    if (this.currentStyles.reverse) {
      classes.push('ansi-reverse');
    }

    const styleAttr = styles.length > 0 ? ` style="${styles.join('; ')}"` : '';
    const classAttr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';

    return `<span${styleAttr}${classAttr}>${text}</span>`;
  }

  /**
   * Escape HTML entities
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Process Claude Code specific output styling
   * @param {string} text - Claude output text
   * @param {string} type - Output type (claude, user, system, etc.)
   * @returns {string} Processed HTML
   */
  renderClaudeOutput(text, type = 'claude') {
    // First, render ANSI codes
    let html = this.renderAdvanced(text);
    
    // Apply Claude-specific styling classes
    const wrapperClass = `claude-output claude-${type}`;
    return `<div class="${wrapperClass}">${html}</div>`;
  }

  /**
   * Clean text but preserve ANSI codes for processing
   * @param {string} text - Raw text
   * @returns {string} Cleaned text with ANSI codes preserved
   */
  cleanForProcessing(text) {
    return text
      // Remove cursor positioning but keep color codes
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[\d;]*[HfABCDEFGJKST]/g, '')
      // Remove clear commands
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[2J/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[K/g, '')
      // Remove other control sequences but keep SGR (color) codes
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[\?[\d;]*[hlc]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][0-2];[^\x07]*\x07/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x07/g, '')
      // Clean up line endings
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  }
}

// Singleton instance
const ansiRenderer = new AnsiRenderer();

export { AnsiRenderer, ansiRenderer, CLAUDE_THEME };
export default ansiRenderer;