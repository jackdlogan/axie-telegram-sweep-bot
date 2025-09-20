import { google, sheets_v4 } from 'googleapis';
import Logger from '../utils/logger';

// Initialize logger
const logger = new Logger('service:sheets');

/**
 * Google Sheets Service for audit logging
 */
class SheetsService {
  private auth: any = null;
  private sheets: sheets_v4.Sheets | null = null;
  // Always hold a string (empty until first initialisation)
  private spreadsheetId: string = '';
  
  /**
   * Check if the service is properly configured
   */
  public isEnabled(): boolean {
    const email = process.env.GOOGLE_SA_EMAIL;
    const key = process.env.GOOGLE_SA_PRIVATE_KEY;
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '1K4wkz6ybcmrh1zvFJADaEczzR_M3oEDPIXQkTSwSrPk';
    
    return !!(email && key && spreadsheetId);
  }
  
  /**
   * Lazily initialize the Google Sheets client
   */
  private getClient(): sheets_v4.Sheets | null {
    if (this.sheets) {
      return this.sheets;
    }
    
    const email = process.env.GOOGLE_SA_EMAIL;
    const key = process.env.GOOGLE_SA_PRIVATE_KEY;
    this.spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '1K4wkz6ybcmrh1zvFJADaEczzR_M3oEDPIXQkTSwSrPk';
    
    if (!email || !key) {
      logger.info('Google Sheets service not configured - missing credentials');
      return null;
    }
    
    try {
      // Replace escaped newlines with actual newlines in the private key
      const formattedKey = key.replace(/\\n/g, '\n');
      
      // Create JWT auth client
      this.auth = new google.auth.JWT({
        email,
        key: formattedKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      
      // Create sheets client
      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      
      logger.info('Google Sheets client initialized successfully');
      return this.sheets;
    } catch (error) {
      logger.error('Failed to initialize Google Sheets client', { error });
      return null;
    }
  }
  
  /**
   * Append a row to a specific tab in the spreadsheet
   * @param tabName Tab name to append to
   * @param row Array of values to append
   * @returns Promise with success status and optional error
   */
  public async appendRow(
    tabName: string,
    row: (string | number)[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.isEnabled()) {
        return {
          success: false,
          error: 'Google Sheets service not configured. Set GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, and GOOGLE_SHEETS_SPREADSHEET_ID environment variables.'
        };
      }
      
      const sheets = this.getClient();
      if (!sheets) {
        return {
          success: false,
          error: 'Failed to initialize Google Sheets client'
        };
      }
      
      // Add timestamp as first column if not provided
      if (typeof row[0] !== 'string' || !row[0].includes(':')) {
        row = [new Date().toISOString(), ...row];
      }
      
      // Append row to the specified tab
      await sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId!,
        range: `${tabName}!A:Z`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [row]
        }
      });
      
      logger.info('Successfully appended row to Google Sheets', { tabName });
      return { success: true };
    } catch (error) {
      logger.error('Failed to append row to Google Sheets', { error, tabName });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Log a sweep action to the Sweep tab
   * @param data Sweep data
   */
  public async logSweepAction(data: {
    collection: string;
    quantity: number;
    axieIds: string[];
    txHash: string;
    wallet: string;
    totalAmount: number;
    gasUsed: number;
    status: string;
  }): Promise<{ success: boolean; error?: string }> {
    const row = [
      new Date().toISOString(),
      data.collection,
      data.quantity,
      data.axieIds.join(','),
      data.txHash,
      data.wallet,
      data.totalAmount,
      data.gasUsed,
      data.status
    ];
    
    return this.appendRow('Sweep', row);
  }
  
  /**
   * Log a transfer action to the Transfer tab
   * @param data Transfer data
   */
  public async logTransferAction(data: {
    collection: string;
    quantity: number;
    axieIds: string[];
    txHash: string;
    wallet: string;
    totalAmount: number;
    gasUsed: number;
    status: string;
  }): Promise<{ success: boolean; error?: string }> {
    const row = [
      new Date().toISOString(),
      data.collection,
      data.quantity,
      data.axieIds.join(','),
      data.txHash,
      data.wallet,
      data.totalAmount,
      data.gasUsed,
      data.status
    ];
    
    return this.appendRow('Transfer', row);
  }
}

// Export singleton instance
const sheetsService = new SheetsService();
export default sheetsService;
