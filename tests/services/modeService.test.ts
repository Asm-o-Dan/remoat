import { ModeService, AVAILABLE_MODES, DEFAULT_MODE } from '../../src/services/modeService';

describe('ModeService', () => {
    let modeService: ModeService;

    beforeEach(() => {
        modeService = new ModeService();
    });

    describe('getCurrentMode - get current mode', () => {
        it('returns the default mode ("default") in the initial state', () => {
            expect(modeService.getCurrentMode()).toBe(DEFAULT_MODE);
            expect(modeService.getCurrentMode()).toBe('default');
        });
    });

    describe('setMode - switch mode', () => {
        it('switches the mode when a valid mode name is specified', () => {
            const result = modeService.setMode('full_machine');
            expect(result.success).toBe(true);
            expect(result.mode).toBe('full_machine');
            expect(modeService.getCurrentMode()).toBe('full_machine');
        });

        it('retains the last set mode after multiple switches', () => {
            modeService.setMode('full_machine');
            modeService.setMode('turbo');
            expect(modeService.getCurrentMode()).toBe('turbo');
        });

        it('returns an error and does not change the mode for an invalid mode name', () => {
            const result = modeService.setMode('invalid_mode');
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(modeService.getCurrentMode()).toBe(DEFAULT_MODE);
        });

        it('sets the mode case-insensitively and handles alias mapping', () => {
            const result = modeService.setMode('TURBO');
            expect(result.success).toBe(true);
            expect(result.mode).toBe('turbo');
        });

        it('returns an error when an empty string is specified', () => {
            const result = modeService.setMode('');
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe('getAvailableModes - get available mode list', () => {
        it('returns the list of available modes', () => {
            const modes = modeService.getAvailableModes();
            expect(modes).toEqual(AVAILABLE_MODES);
            expect(modes.length).toBe(3);
            expect(modes).toContain('default');
            expect(modes).toContain('full_machine');
            expect(modes).toContain('turbo');
        });
    });
});
