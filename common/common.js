'use strict';

import {
    SettingsTracker,
} from '../common/settings.js';


/** Values that can be used to activate functionality for debugging.  */
export const debug = {
    /** Show an indicator in the popup for if the window has its `isRestored` session data set. */
    popup_sessionRestoreTracking: false,
};

/** Keys for window session data. */
export const windowDataKeys = Object.freeze({
    /** The name of a window. */
    name: 'name',
    /** Window specific settings that should override the global settings. */
    settings: 'settings',
    /** A marker value that indicates that this window has been seen before, allows handling restored windows differently from new windows. */
    isRestored: 'isRestored',
});
/** Messages that can be sent to the background page via a Port connection. */
export const messageTypes = Object.freeze({
    /** Notify that a window's session data was changed. */
    windowDataChange: 'windowDataChange',
    /** Request that all window prefixes be cleared. */
    clearPrefix: 'clearPrefix',
    /** Request that all window prefixes are updated and set again. */
    updatePrefix: 'updatePrefix',
    /** Notify that a permission might have been granted or revoked. */
    permissionsChanged: 'permissionsChanged',
    /** Request that the background page requests a permission from the user. */
    requestPermission: 'requestPermission',
    /** Request that the background page clear all window session data. */
    clearWindowData: 'clearWindowData',
    /** Request that all windows have their names changed to a specified name. */
    applyWindowName: 'applyWindowName',
});


export class FormatPlaceholder {
    constructor(format, message, { regExpFlags = 'ig' } = {}) {
        const createRegExp = (string) => new RegExp(string.replace('(', '\\(').replace(')', '\\)'), regExpFlags);
        if (typeof format === 'object') {
            const { start, args = [], end } = format;
            const separators = args.filter((val, index) => index % 2 === 1);

            this.start = start;
            this.startRegExp = createRegExp(start);

            this.args = args;

            this.separators = separators;
            this.separatorsRegExp = separators.map(sep => createRegExp(sep));

            this.end = end;
            this.endRegExp = createRegExp(end);

            this.isFunction = true;
            this.format = start + args.join('') + end;
        } else {
            this.format = format;
            this.regExp = createRegExp(this.format);
            this.isFunction = false;
        }

        this.message = message;
        this.messageText = '';

        if (message) {
            try {
                this.messageText = browser.i18n.getMessage(message, this.format);
            } catch (error) {
                console.error('Failed to get format placeholder message!\nMessage: ', message, '\nError: ', error);
            }
        }
    }

    /**
     * Apply this placeholder to a string.
     *
     * @param {string} text The text to apply the placeholder to.
     * @param {string|function} valueOrCallback Either the string to replace the placeholder with or a function that lazily determines the string. If a function is used it will also be passed string arguments if the placeholder requires that.
     * @returns {string} The text after the placeholder has been replaced.
     * @memberof FormatPlaceholder
     */
    apply(text, valueOrCallback) {
        if (!text || typeof text !== 'string')
            return text;
        const isCallback = valueOrCallback && typeof valueOrCallback === 'function';
        if (!this.isFunction) {
            let value = valueOrCallback;
            if (isCallback) {
                if (this.test(text)) {
                    value = valueOrCallback();
                } else {
                    return text;
                }
            }
            return text.replace(this.regExp, value);
        } else {
            if (!isCallback)
                return text;

            let processedText = '';
            let unprocessedText = text;
            let searchText = text;
            const requestText = (textToFind, regExp) => {
                const index = regExp ? searchText.search(regExp) : searchText.indexOf(textToFind);
                if (index < 0)
                    return null;
                const endIndex = index + textToFind.length;
                const found = searchText.slice(0, index);
                searchText = searchText.slice(endIndex);
                return found;
            };

            while (true) {
                const beforePlaceholder = requestText(this.start, this.startRegExp);
                if (beforePlaceholder === null)
                    break;

                let args = [];
                for (let iii = 0; iii < this.separators.length && iii < this.separatorsRegExp.length; iii++) {
                    let value = requestText(this.separators[iii], this.separatorsRegExp[iii]);
                    if (value === null) {
                        args = null;
                        break;
                    } else {
                        args.push(value);
                    }
                }
                if (!args)
                    break;

                let lastArg = requestText(this.end, this.endRegExp);
                if (lastArg === null)
                    break;
                if (this.args.length > 0) {
                    args.push(lastArg);
                } else if (lastArg !== '')
                    break;

                const replacement = valueOrCallback(...args);

                // Update return text:
                processedText += beforePlaceholder + replacement;
                unprocessedText = searchText;
            }
            return processedText + unprocessedText;
        }
    }

    /**
     * Tests if this format placeholder is present in some text.
     *
     * @param {string} string The string that should be checked for the placeholder.
     * @returns {boolean} True
     * @memberof FormatPlaceholder
     */
    test(string) {
        if (!string || typeof string !== 'string') {
            return false;
        } else {
            if (this.regExp) {
                return string.search(this.regExp) >= 0;
            } else {
                let found = false;
                this.apply(string, () => {
                    found = true;
                    return '';
                });
                return found;
            }
        }
    }

    /**
     * Gets info about a string that contains FormatPlaceholders.
     *
     * @static
     * @param {string} titleFormat A string that contains placeholders.
     * @returns {Object} Info about the string and the placeholders that it contains.
     * @memberof FormatPlaceholder
     */
    static createFormatInfo(titleFormat) {
        const info = {
            hasText: titleFormat && titleFormat != '',
        };
        for (const [key, value] of Object.entries(formatPlaceholders)) {
            info['use' + key[0].toUpperCase() + key.slice(1)] = value.test(titleFormat);
        }
        return info;
    }

    /**
     * Gets info about a collection of FormatInfo objects.
     *
     * @static
     * @param {string|Object|Array} formatInfos A string or array of strings to collect format info about.
     * @returns {Object} An object that contains info about the placeholders in some strings.
     * @memberof FormatPlaceholder
     */
    static combineFormatInfos(formatInfos) {
        if (!formatInfos) {
            return;
        }
        if (!Array.isArray(formatInfos)) {
            formatInfos = [formatInfos];
        }
        if (formatInfos.length === 0) {
            return [];
        }
        if (formatInfos.length === 1) {
            return formatInfos[0];
        }
        let combined = FormatPlaceholder.createFormatInfo('');
        for (let formatInfo of formatInfos) {
            if (!formatInfo) {
                continue;
            }
            if (typeof formatInfo === 'string') {
                formatInfo = FormatPlaceholder.createFormatInfo(formatInfo);
            }
            if (Array.isArray(formatInfo)) {
                if (formatInfo.length === 0) {
                    continue;
                }
                if (formatInfo.length === 1) {
                    formatInfo = formatInfo[0];
                } else {
                    formatInfo = FormatPlaceholder.combineFormatInfos(formatInfo);
                }
            }
            for (const key of Object.keys(formatInfo)) {
                if (formatInfo[key]) {
                    combined[key] = formatInfo[key];
                }
            }
        }
        return combined;
    }

    static get all() {
        return Object.values(formatPlaceholders);
    }
}

export const formatPlaceholders = Object.freeze({
    /** Tab count in current window. */
    tabCount: new FormatPlaceholder('%TabCount%', 'options_FormatPlaceholders_TabCount'),
    /** Total tab count. */
    totalTabCount: new FormatPlaceholder('%TotalTabCount%', 'options_FormatPlaceholders_TotalTabCount'),

    /** The index of the active tab (starts at 1) */
    activeTabIndex: new FormatPlaceholder('%ActiveTabIndex%', 'options_FormatPlaceholders_ActiveTabIndex'),

    /** Different placeholders for when window name is defined or not. */
    ifWindowName: new FormatPlaceholder(
        {
            start: '%IfWindowName(',
            args: ['True', ',', 'False'],
            end: ')%',
        },
        'options_FormatPlaceholders_IfWindowName'
    ),

    /** An advanced placeholder that will create a regular expression from some provided text and match it against a different text to determine the final result of the placeholder. */
    ifRegexMatch: new FormatPlaceholder(
        {
            start: '%IfRegexMatch(',
            args: ['TextToMatchAgainst', ',', 'Regex', ',', 'RegexFlags', ',', 'True', ',', 'False'],
            end: ')%',
        },
        'options_FormatPlaceholders_IfRegexMatch',
    ),

    /** User defined window name. */
    windowName: new FormatPlaceholder('%WindowName%', 'options_FormatPlaceholders_WindowName'),
    /** Unique identifier. Starts as 1 and increments until unique. */
    count: new FormatPlaceholder('%Count%', 'options_FormatPlaceholders_Count'),


    /** Firefox version: string representing the browser's version, for example "51.0" or "51.0a2". */
    firefoxVersion: new FormatPlaceholder('%FirefoxVersion%', 'options_FormatPlaceholders_FirefoxVersion'),
    /** Firefox build id: string representing the specific build of the browser, for example "20161018004015". */
    firefoxBuildId: new FormatPlaceholder('%FirefoxBuildId%', 'options_FormatPlaceholders_FirefoxBuildId'),

    /** The platform's operating system. */
    platformOS: new FormatPlaceholder('%OS%', 'options_FormatPlaceholders_OS'),
    /** The platform's processor architecture. */
    platformArchitecture: new FormatPlaceholder('%Architecture%', 'options_FormatPlaceholders_Architecture'),

    /** Escaped special character (%). */
    percent: new FormatPlaceholder('%Percent%', 'options_FormatPlaceholders_Percent'),
    /** Escaped special character (,). */
    comma: new FormatPlaceholder('%Comma%', 'options_FormatPlaceholders_Comma'),
});


// #region Settings

export function getDefaultSettings() {
    return {
        /** Disable all dynamic functionality. */
        isEnabled: true,
        /** Don't count tabs for private windows. */
        ignorePrivateWindows: true,
        /** Don't set window prefixes in private windows. */
        dontSetPrivateWindowTitles: true,

        timeBetweenUpdatesInMilliseconds: 100,
        windowPrefixFormat: '[%TabCount%] %IfWindowName(%WindowName% | ,)%',

        windowDefaultName: '',
        windowInheritName: false,
        windowInheritSettings: false,
        windowTrackSessionRestore: true,

        newTabNoTitleWorkaround_Enabled: false,
        newTabNoTitleWorkaround_TrackHandledTabs: false,
        newTabNoTitleWorkaround_LoadWaitInMilliseconds: -1,
        newTabNoTitleWorkaround_ReloadWaitInMilliseconds: 10000,
        newTabNoTitleWorkaround_MinPrefixWaitInMilliseconds: -1,

        disableOptionsPageAnimations: false,
        optionsPage_disableDarkTheme: false,

        /** Disable animations for the browser action popup page. */
        disablePopupPageAnimations: false,
        /** Disable dark theme support for the browser action popup page. */
        popupPage_disableDarkTheme: false,
        /** Default width of the popup page in pixels. */
        popupPage_width: 220,
    };
}

export const settingsTracker = new SettingsTracker({ defaultValues: getDefaultSettings });
export const settings = settingsTracker.settings;

// eslint-disable-next-line valid-jsdoc
/**
 * Load a specific setting as fast as possible.
 *
 * @template {keyof ReturnType<typeof getDefaultSettings>} K
 * @param {K} key The key of the setting that should be loaded.
 * @returns {Promise<(ReturnType<typeof getDefaultSettings>[K])>} The value for the loaded setting.
 */
export function quickLoadSetting(key) {
  // @ts-ignore
  return SettingsTracker.get(key, getDefaultSettings()[key]);
}

// #endregion Settings
