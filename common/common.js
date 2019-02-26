
// #region Constants

const messagePrefix = 'message_';

const debug = {
  popop_sessionRestoreTracking: false,
};

const windowDataKeys = Object.freeze({
  name: 'name',
  settings: 'settings',
  isRestored: 'isRestored',
});
const messageTypes = Object.freeze({
  windowDataChange: 'windowDataChange',
  clearPrefix: 'clearPrefix',
  updatePrefix: 'updatePrefix',
  permissionsChanged: 'permissionsChanged',
  requestPermission: 'requestPermission',
  clearWindowData: 'clearWindowData',
  applyWindowName: 'applyWindowName',
});

class FormatPlaceholder {
  constructor(format, message, { regExpFlags = 'ig' } = {}) {
    const createRegExp = (string) => new RegExp(string.replace('(', '\\(').replace(')', '\\)'), regExpFlags);
    if (typeof format === 'object') {
      const { start, args = [], end } = format;
      const separators = args.filter((val, index) => index % 2 === 1);
      Object.assign(this, {
        start,
        startRegExp: createRegExp(start),

        args,
        separators,
        separatorsRegExp: separators.map(sep => createRegExp(sep)),

        end,
        endRegExp: createRegExp(end),
      });
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
   * @param {*} text The text to apply the placeholder to.
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

const formatPlaceholders = Object.freeze({
  tabCount: new FormatPlaceholder('%TabCount%', 'options_FormatPlaceholders_TabCount'),                       // Tab count in current window.
  totalTabCount: new FormatPlaceholder('%TotalTabCount%', 'options_FormatPlaceholders_TotalTabCount'),        // Total tab count.

  // Different placeholders for when window name is defined or not.
  ifWindowName: new FormatPlaceholder(
    {
      start: '%IfWindowName(',
      args: ['True', ',', 'False'],
      end: ')%',
    },
    'options_FormatPlaceholders_IfWindowName'
  ),

  windowName: new FormatPlaceholder('%WindowName%', 'options_FormatPlaceholders_WindowName'),                 // User defined window name.
  count: new FormatPlaceholder('%Count%', 'options_FormatPlaceholders_Count'),                                // Unique identifier. Starts as 1 and increments untill unique.


  firefoxVersion: new FormatPlaceholder('%FirefoxVersion%', 'options_FormatPlaceholders_FirefoxVersion'),     // Firefox version: string representing the browser's version, for example "51.0" or "51.0a2".
  firefoxBuildId: new FormatPlaceholder('%FirefoxBuildId%', 'options_FormatPlaceholders_FirefoxBuildId'),     // Firefox build id: string representing the specific build of the browser, for example "20161018004015".

  platformOS: new FormatPlaceholder('%OS%', 'options_FormatPlaceholders_OS'),                                 // The platform's operating system.
  platformArchitecture: new FormatPlaceholder('%Architecture%', 'options_FormatPlaceholders_Architecture'),   // The platform's processor architecture.
});


const defaultValues = Object.freeze({
  get Settings() {
    return {
      isEnabled: true,                                            // Disable all dynamic functionality.
      ignorePrivateWindows: true,                                 // Don't count tabs for private windows.
      dontSetPrivateWindowTitles: true,                           // Don't set window prefixes in private windows.

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
      disablePopupPageAnimations: false,
    };
  }
});

// #endregion Constants


// #region Utilities

async function delay(timeInMilliseconds) {
  return await new Promise((resolve, reject) => timeInMilliseconds < 0 ? resolve() : setTimeout(resolve, timeInMilliseconds));
}

/**
 * A delay that will be canceled if a disposable collection is disposed.
 * 
 * @param {number} timeInMilliseconds Time in milliseconds to wait.
 * @param {DisposableCollection} [disposables=null] Disposables collection to bind delay to.
 * @returns {boolean} True if successful. False if canceled.
 */
async function boundDelay(timeInMilliseconds, disposables = null) {
  if (!disposables) {
    await delay(timeInMilliseconds);
    return true;
  }
  return new Promise((resolve, reject) => {
    try {
      let timeout = new Timeout(() => {
        resolve(true);
      }, timeInMilliseconds);
      timeout.onDisposed.addListener(() => {
        resolve(false);
      });
      if (disposables) {
        disposables.trackDisposables(timeout);
      }
    } catch (error) {
      reject(error);
    }
  });
}

let createObjectFromKeys = function (
  keys,                   // array of strings.
  values,                 // object, or array of objects.
  defaultValue = null     // object.
) {
  if (keys && Array.isArray(keys)) {
    let data = {};
    let valueIsArray = Array.isArray(values);
    for (let i = 0; i < keys.length; i++) {
      if (typeof keys[i] === 'string')
        data[keys[i]] = valueIsArray ? (i < values.length ? values[i] : defaultValue) : values;
    }
    return data;
  } else {
    return keys;
  }
};

let defineProperty = (obj, propertyName, get, set) => {
  let getSet = {};
  if (get) {
    getSet.get = get;
  }
  if (set) {
    getSet.set = set;
  }
  Object.defineProperty(obj, propertyName, getSet);
};

let accessDataObjectWithProperties = (accessObject, dataObject) => {
  let onChangeManager = new EventManager();
  let propKeys = Object.keys(dataObject);

  for (let key of propKeys) {
    defineProperty(accessObject, key,
      function () {
        return dataObject[key];
      },
      function (value) {
        if (dataObject[key] === value) {
          return;
        }
        let old = dataObject[key];
        dataObject[key] = value;
        onChangeManager.fire(key, old, value);
      }
    );
  }
  return onChangeManager.subscriber;
};

let checkAny = (array) => {
  array = array.filter(value => value);
  if (array.length === 0) {
    return false;
  }

  let promiseWrapper = new PromiseWrapper();

  let promises = 0;
  let waitForValue = async (value) => {
    try {
      value = await value;
      if (value) {
        promiseWrapper.resolve(value);
      }
    } finally {
      promises--;

      if (promises <= 0) {
        promiseWrapper.resolve(false);
      }
    }
  };

  promises++;
  for (let value of array) {
    promises++;
    waitForValue(value);
  }
  promises--;

  if (promises <= 0) {
    promiseWrapper.resolve(false);
  }
  return promiseWrapper.getValue();
};

/**
 * Copy an object by serializing and then deserializing it with JSON.
 * 
 * @param {Object} value Object to copy.
 * @returns {Object} A copy of the provided object.
 */
let deepCopy = (value) => {
  if (!value) {
    return value;
  }
  if (typeof value === 'string') {
    return value;
  }
  let jsonCopy = JSON.parse(JSON.stringify(value));
  return jsonCopy;
};

/**
 * Compare two object by serializing them to JSON.
 * 
 * @param {Object} a The first object.
 * @param {Object} b The second object.
 * @returns {boolean} If they are equal
 */
let deepCopyCompare = (a, b) => {
  if (a === b) {
    return true;
  }
  if (!a && !b) {
    return a === b;
  }
  if (!a || !b) {
    return false;
  }
  let aString = typeof a === 'string';
  let bString = typeof b === 'string';
  if (aString && bString) {
    return a === b;
  } else if (aString || bString) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
};

// #endregion Utilities


// #region Settings

/**
 * The extension's settings.
 * 
 * @class Settings
 */
class Settings {
  constructor() {
    Object.assign(this, Settings.getDefaultValues());
  }

  static getDefaultValues() {
    return defaultValues.Settings;
  }


  // #region Manage storage

  static async get(
    key,                    // string, array of string, or object (property names are keys and values are set values).
    defaultValue = null     // object, or array of objects. Ignored if key is an object (not string).
  ) {
    if (typeof key === "string") {
      return (await browser.storage.local.get({ [key]: defaultValue }))[key];
    } else {
      let data = createObjectFromKeys(key, defaultValue);
      return await browser.storage.local.get(data);
    }
  }
  static async set(
    key,            // string, array of string, or object (property names are keys and values are set values).
    value = null    // object, or array of objects. Ignored if key is an object (not string).
  ) {
    if (typeof key === "string") {
      return await browser.storage.local.set({
        [key]: value
      });
    } else {
      let data = createObjectFromKeys(key, value);
      return await browser.storage.local.set(data);
    }
  }
  static async remove(
    key     // string, or array of strings.
  ) {
    return browser.storage.local.remove(key);
  }
  static async clear() {
    return browser.storage.local.clear();
  }

  // #endregion Manage storage


  /**
   * Create an event listener for storage changes.
   * 
   * @static
   * @param {any} callback (changes, areaName) Function that will be called when this event occurs. The function will be passed the following arguments:
   * changes:    object. Object describing the change. This contains one property for each key that changed. The name of the property is the name of the key that changed, and its value is a storage.StorageChange object describing the change to that item.
   * areaName:   string. The name of the storage area ("sync", "local" or "managed") to which the changes were made.
   * @returns {EventListener} An event listener for browser.storage.onChanged.
   * @memberof Settings
   */
  static createChangeEventListener(callback) {
    return new EventListener(browser.storage.onChanged, callback);
  }
}


/**
 * Keeps a settings object up to date and notifies of any changes.
 * 
 * @class SettingsTracker
 */
class SettingsTracker {
  constructor(storageArea = null, callback = null, fallbackToDefault = true) {
    if (!storageArea || typeof storageArea !== "string") {
      storageArea = "local";
    }

    defineProperty(this, 'fallbackToDefault', () => fallbackToDefault, (value) => { fallbackToDefault = value; });

    var onChange = new EventManager();
    this.onChange = onChange.subscriber;
    onChange.addListener(callback);

    this.settings = new Settings();

    let changedProperties = [];
    let changeListener = Settings.createChangeEventListener((changes, areaName) => {
      if (areaName === storageArea) {
        let keys = Object.keys(changes);
        if (changedProperties) {
          changedProperties.push.apply(keys.filter((change) => !changedProperties.includes(change)));
        }
        let defaultSettings;
        let defaultSettingsKeys;
        for (let key of keys) {
          if (Object.keys(changes[key]).includes('newValue')) {
            this.settings[key] = changes[key].newValue;
          } else {
            if (fallbackToDefault && (!defaultSettings || !defaultSettingsKeys)) {
              defaultSettings = Settings.getDefaultValues();
              defaultSettingsKeys = Object.keys(defaultSettings);
            }
            if (fallbackToDefault && defaultSettingsKeys.includes(key)) {
              this.settings[key] = defaultSettings[key];
            } else {
              delete this.settings[key];
            }
          }
        }
        onChange.fire(changes, areaName);
      }
    });
    let start = async () => {
      let allSettings = await Settings.get(null);
      for (let key of Object.keys(allSettings)) {
        if (!changedProperties.includes(key)) {
          this.settings[key] = allSettings[key];
        }
      }
      changedProperties = null;
    };

    this.start = start();
    this.stop = () => {
      changeListener.close();
    };
  }
}

// #endregion Settings


// #region Events

/**
 * Listens to an event.
 * 
 * @class EventListener
 */
class EventListener {

  /**
   * Creates an instance of EventListener.
   * @param {any} DOMElementOrEventObject If DOM event: the DOM object to listen on. Otherwise: the event object to add a listener to.
   * @param {any} eventNameOrCallback If DOM event: the name of the event. Otherwise: callback.
   * @param {any} callbackOrExtraParameters If DOM event: callback. Otherwise: optional extra paramater for the add listener function.
   * @memberof EventListener
   */
  constructor(DOMElementOrEventObject, eventNameOrCallback, callbackOrExtraParameters = null) {
    Object.assign(this, {
      _onClose: null,
    });

    if (typeof eventNameOrCallback === 'string' && typeof callbackOrExtraParameters === 'function') {
      this._DOMElement = DOMElementOrEventObject;
      this._event = eventNameOrCallback;
      this._callback = callbackOrExtraParameters;
    } else {
      this._event = DOMElementOrEventObject;
      this._callback = eventNameOrCallback;
      this._extraParameter = callbackOrExtraParameters;
    }

    if (this._DOMElement) {
      this._DOMElement.addEventListener(this._event, this._callback);
    } else {
      if (this._extraParameter) {
        this._event.addListener(this._callback, this._extraParameter);
      } else {
        this._event.addListener(this._callback);
      }
    }
  }

  close() {
    if (this._callback) {
      if (this._DOMElement) {
        this._DOMElement.removeEventListener(this._event, this._callback);
      } else {
        this._event.removeListener(this._callback);
      }
      this._callback = null;
      if (this._onClose) {
        this._onClose.fire(this);
      }
    }
  }

  get isDisposed() {
    return !Boolean(this._callback);
  }
  get isActive() {
    if (this._DOMElement) {
      return !this.isDisposed;
    } else {
      return this._event.hasListener(this._callback);
    }
  }

  get onClose() {
    if (!this._onClose) {
      this._onClose = new EventManager();
    }
    return this._onClose.subscriber;
  }
}


/**
 * Keeps track of listeners for an event.
 * 
 * @class EventSubscriber
 */
class EventSubscriber {
  constructor(changeCallback = null) {
    this._listeners = [];
    if (changeCallback && typeof changeCallback === 'function') {
      this._changeCallback = changeCallback;
    }
  }

  addListener(listener) {
    if (!listener || typeof listener !== 'function') {
      return;
    }
    if (this._listeners.includes(listener)) {
      return;
    }
    this._listeners.push(listener);
    if (this._changeCallback) {
      this._changeCallback(this, listener, true);
    }
  }
  removeListener(listener) {
    let removed = false;
    while (true) {
      let index = this._listeners.indexOf(listener);
      if (index < 0) {
        break;
      }
      removed = true;
      this._listeners.splice(index, 1);
    }
    if (this._changeCallback && removed) {
      this._changeCallback(this, listener, false);
    }
  }
  hasListener(listener) {
    return this._listeners.includes(listener);
  }
}


/**
 * Advanced features for an event subscriber such as calling all listeners.
 * 
 * @class EventManager
 * @extends {EventSubscriber}
 */
class EventManager extends EventSubscriber {
  constructor() {
    super();
    this._changeCallback = this._handleChange.bind(this);
  }

  _handleChange() {
    if (this._onChange) {
      this._onChange.fire.apply(this._onChange, Array.from(arguments));
    }
  }

  fire() {
    let returned = [];
    if (this._listeners.length > 0) {
      let args = Array.from(arguments);
      for (let listener of this._listeners.slice()) {
        try {
          returned.push(listener.apply(null, args));
        } catch (error) {
          console.error('Error during event handling!\n', error, '\nStack Trace:\n', error.stack);
        }
      }
    }
    return returned;
  }

  get listeners() {
    return this._listeners.slice();
  }
  set listeners(value) {
    this._listeners = value;
    if (this._onChange) {
      this._onChange.fire(this);
    }
  }

  get listenersLength() {
    return this._listeners.length;
  }

  /**
   * An event that is triggered when the event listeners are changed. Args: manager, listener [optional], added [optional]
   * 
   * @readonly
   * @memberof EventManager
   */
  get onChanged() {
    if (!this._onChange) {
      this._onChange = new EventManager();
    }
    return this._onChange;
  }

  /**
   * 
   * 
   * @returns {EventSubscriber} A event subscriber that is connected to this manager.
   * @readonly
   * @memberof EventManager
   */
  get subscriber() {
    if (!this._subscriber) {
      this._subscriber = new EventSubscriber(this._changeCallback);
      defineProperty(this._subscriber, '_listeners', () => this._listeners, (value) => { this._listeners = value; });
    }
    return this._subscriber;
  }

  /**
   * Create an event that passes on data from another event.
   * 
   * @static
   * @param {EventSubscriber} originalEvent The original event.
   * @param {Function} [returnModifier=null] Allows modifying the returned values. The first arg is the an array of the listeners returned value. The array returned by this function will be used instead. If a false value is returned it will be used as return value.
   * @param {Function} [argumentModifier=null] Modify the arguments passed to the listeners. The first arg is an array of the args that will be used. The array returned by this function will be used instead. If a false value is returned then the listeners will not be called.
   * @returns {EventSubscriber} The modified event.
   * @memberof EventManager
   */
  static createPassthroughEventManager(originalEvent, returnModifier = null, argumentModifier = null) {
    var checkIfFunction = (test) => test && typeof test === 'function';
    var hasReturnMod = checkIfFunction(returnModifier);
    var hasArgMod = checkIfFunction(argumentModifier);

    var originalEventListener = null;
    var passthroughEventManager = new EventManager();

    var start = () => {
      if (!originalEventListener) {
        originalEventListener = new EventListener(originalEvent, function () {
          let args = Array.from(arguments);
          if (hasArgMod) {
            args = argumentModifier(args);
            if (!args || !Array.isArray(args)) {
              return;
            }
          }
          let returned = passthroughEventManager.fire.apply(passthroughEventManager, args);
          if (hasReturnMod) {
            returned = returnModifier(returned);
            if (!returned || !Array.isArray(returned)) {
              return returned;
            }
          }
          if (returned.length === 0) {
            return;
          }
          if (returned.length === 1) {
            if (hasReturnMod) {
              return returnModifier(returned[0]);
            }
            return returned[0];
          }
          let firstNotUndefined;
          for (let value of returned) {
            if (value) {
              return value;
            }
            if (firstNotUndefined === undefined && value !== undefined) {
              firstNotUndefined = value;
            }
          }
          return firstNotUndefined;
        });
      }
    };
    var stop = () => {
      if (originalEventListener) {
        originalEventListener.close();
        originalEventListener = null;
      }
    };

    passthroughEventManager.onChanged.addListener(() => {
      if (passthroughEventManager.listenersLength === 0) {
        stop();
      } else {
        start();
      }
    });

    return passthroughEventManager;
  }
}

// #endregion Events


// #region Delays

/**
 * Allows synchronous access to a Promise's resolve and reject functions.
 * 
 * @class PromiseWrapper
 */
class PromiseWrapper {

  /**
   * Creates an instance of PromiseWrapper.
   * @param {boolean} [createPromise=true] Determines if a promise should be created immediately.
   * @memberof PromiseWrapper
   */
  constructor(createPromise = true) {
    Object.assign(this, {
      _resolve: null,
      _reject: null,
      _value: null,
      _isError: false,
      _set: false,
      _promise: null,
    });

    if (createPromise) {
      this.createPromise();
    }
  }


  resolve(value) {
    this.setValue(value, false);
  }

  reject(error) {
    this.setValue(error, true);
  }

  setValue(value, isError = false) {
    if (this._set) {
      return;
    }
    this._set = true;
    this._isError = isError;
    this._value = value;

    if (isError) {
      if (this._reject) {
        this._reject(value);
      }
    } else {
      if (this._resolve) {
        this._resolve(value);
      }
    }
  }

  createPromise() {
    if (this.isPromiseCreated) {
      return;
    }
    this._promise = new Promise((resolve, reject) => {
      if (this._set) {
        if (this._isError) {
          reject(this._value);
        } else {
          resolve(this._value);
        }
      }
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  /**
   * Returns a promise if it is available or if it is the only way to provide the results.
   * 
   * @returns {any} Either a promise that will be resolved to the correct value or the value that the promise would have been resolved to.
   * @memberof PromiseWrapper
   */
  getValue() {
    if (this.isPromiseCreated || !this.done || this.isError) {
      return this.promise;
    }
    return this.value;
  }

  get promise() {
    this.createPromise();
    return this._promise;
  }

  get isPromiseCreated() {
    return Boolean(this._promise);
  }

  /**
   * Indicates if the promise has a value, that is to say has been resolved or rejected.
   * 
   * @readonly
   * @memberof PromiseWrapper
   */
  get done() {
    return Boolean(this._set);
  }

  /**
   * Indicates if the promise was rejected.
   * 
   * @readonly
   * @memberof PromiseWrapper
   */
  get isError() {
    return Boolean(this._isError);
  }

  /**
   * The value that the promise was resolved or rejected with.
   * 
   * @readonly
   * @memberof PromiseWrapper
   */
  get value() {
    return this._value;
  }

}


/**
 * Tracks disposables and disposes of them when a promise is resolved.
 * 
 * @class OperationManager
 */
class OperationManager {
  constructor() {
    var promiseWrapper = new PromiseWrapper(false);
    let disposableCollection = new DisposableCollection();

    let setValue = (value, isError = false) => {
      if (isError) {
        promiseWrapper.reject(value);
      } else {
        promiseWrapper.resolve(value);
      }
      disposableCollection.dispose();
    };

    this.trackDisposables = (disposables) => disposableCollection.trackDisposables(disposables);

    defineProperty(this, 'done', () => promiseWrapper.done);

    defineProperty(this, 'value',
      () => promiseWrapper.getValue(),
      (value) => setValue(value)
    );

    this.resolve = (value) => setValue(value);
    this.reject = (value) => setValue(value, true);
  }
}


/**
 * Wrap a setTimeout call and keep track of the timeoutId.
 * 
 * @class Timeout
 */
class Timeout {

  constructor(callback, timeInMilliseconds) {
    Object.assign(this, {
      _isDisposed: false,
      _onDisposed: new EventManager(),

      _timeoutId: null,
      _callback: callback,

      _timeInMilliseconds: timeInMilliseconds,
    });
    this._start();
  }

  _start() {
    if (this._callback && typeof this._callback === 'function') {
      this._timeoutId = setTimeout(() => {
        this._timeoutId = null;
        try {
          this._callback();
        } finally {
          this.dispose();
        }
      }, this._timeInMilliseconds);
    }
  }


  // #region Dispose

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    this._onDisposed.fire(this);
  }
  get isDisposed() {
    return this._isDisposed;
  }
  get onDisposed() {
    return this._onDisposed.subscriber;
  }

  close() {
    this.dispose();
  }
  get isClosed() {
    return this.isDisposed;
  }
  get onClosed() {
    return this.onDisposed;
  }

  stop() {
    this.dispose();
  }
  get isStoped() {
    return this.isDisposed;
  }
  get onStop() {
    return this.onDisposed;
  }
  get onStoped() {
    return this.onDisposed;
  }

  get isActive() {
    return Boolean(this._timeoutId !== null);
  }

  // #endregion Dispose

  get promise() {
    return new Promise((resolve, reject) => {
      if (this.isDisposed) {
        resolve();
      } else {
        this.onDisposed.addListener(resolve);
      }
    });
  }

  get callback() {
    return this._callback;
  }

}


/**
 * Ensure a callback isn't called too often.
 * 
 * @class RequestManager
 */
class RequestManager {

  constructor(callback = null, blockTimeInMilliseconds = 1000, simultaneousUpdates = false) {
    Object.assign(this, {
      _isDisposed: false,
      _onDisposed: new EventManager(),

      _onUpdate: new EventManager(),

      _blockTimeout: null,
      _invalidated: false,
      _lastArgs: [],
      _confirmPromiseWrapper: new PromiseWrapper(),

      _simultaneousUpdates: simultaneousUpdates,
      _updates: 0,

      blockTimeInMilliseconds: blockTimeInMilliseconds,
    });

    this._onUpdate.addListener(callback);
  }

  /**
   * Block all updates.
   * 
   * @param {any} [overrideTime=null] The time to block the updates in milliseconds. If false the default time will be used.
   * @returns {Timeout} A Timeout object that will be closed when the block has expired.
   * @memberof RequestManager
   */
  block(overrideTime = null) {
    if (this._blockTimeout) {
      this._blockTimeout.stop();
    }
    if (this.isDisposed) {
      return;
    }
    let time;
    if (overrideTime || overrideTime === 0) {
      time = overrideTime;
    } else if (typeof this.blockTimeInMilliseconds === 'function') {
      time = this.blockTimeInMilliseconds();
    } else {
      time = this.blockTimeInMilliseconds;
    }
    this._blockTimeout = new Timeout(() => this.unblock(), time);
    return this._blockTimeout;
  }

  /**
   * Unblock and update if invalidated.
   * 
   * @memberof RequestManager
   */
  unblock() {
    if (this._blockTimeout) {
      this._blockTimeout.stop();
    }
    if (this.isInvalidated) {
      this._update();
    }
  }

  /**
   * Unblock and update. Forces an update now and block after it.
   * 
   * @memberof RequestManager
   */
  async forceUpdate() {
    this._lastArgs = Array.from(arguments);
    await this._update(true);
  }

  async _update(external = false) {
    if (this.isDisposed) {
      return;
    }
    if (!this._simultaneousUpdates && this.updateInProgress) {
      // Unblocked but last update has yet to complete.
      this._invalidated = true;
      if (external) {
        await this._confirmPromiseWrapper.getValue();
      }
      return;
    }

    let b = this.block();
    this._invalidated = false;

    let args = this._lastArgs;
    this._lastArgs = [];

    let affectedConfirmPromise = this._confirmPromiseWrapper;
    this._confirmPromiseWrapper = new PromiseWrapper();
    this._confirmPromiseWrapper.promise.then((value) => affectedConfirmPromise.resolve(value));

    let releaseBlock = false;
    try {
      this._updates++;
      releaseBlock = await checkAny(this._onUpdate.fire.apply(this._onUpdate, args));

      if (releaseBlock && b === this._blockTimeout) {
        this.unblock();
      }
    } finally {
      this._updates--;
      affectedConfirmPromise.resolve(true);
      if (!this.isBlocked && this.isInvalidated) {
        if (this._simultaneousUpdates || !this.updateInProgress) {
          this._update();
        }
      }
    }
  }

  /**
   * Update after block is released.
   * 
   * @returns {boolean} True if update was successful.
   * @memberof RequestManager
   */
  async invalidate() {
    if (this.isDisposed) {
      return false;
    }
    this._invalidated = true;
    this._lastArgs = Array.from(arguments);
    let updatePromise = this._confirmPromiseWrapper.getValue();
    if (!this.isBlocked) {
      this._update();
    }
    return updatePromise;
  }


  get isBlocked() {
    return this._blockTimeout && this._blockTimeout.isActive;
  }

  get updateInProgress() {
    return this._updates > 0;
  }

  get lastArgs() {
    return this._lastArgs;
  }

  get isInvalidated() {
    return this._invalidated;
  }

  get onUpdate() {
    return this._onUpdate.subscriber;
  }


  // #region Dispose

  /**
   * Unblock and prevent further updates.
   * 
   * @memberof RequestManager
   */
  dispose() {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;

    this._confirmPromiseWrapper.resolve(false);
    this.unblock();

    this._onDisposed.fire(this);
  }

  get isDisposed() {
    return this._isDisposed;
  }
  get onDisposed() {
    return this._onDisposed.subscriber;
  }

  // #endregion Dispose

}


/**
 * Delay events and handle them later.
 * 
 * @class EventQueue
 */
class EventQueue {
  constructor() {
    Object.assign(this, {
      _isDisposed: false,

      queuedEvents: [],
      unsafeToContinue: false,
    });
  }

  /**
   * Handle an event. The callback might be delayed.
   * 
   * @param {Function} callback Function to call when the event should be handled. First arg is a Boolean that is true if the callback was delayed.
   * @param {boolean} [safeToDelay=false] Indicates if it is safe to delay the event handler.
   * @memberof EventQueue
   */
  handleEvent(callback, safeToDelay = false) {
    if (this.queuedEvents) {
      this.queuedEvents.push(callback);
      if (!safeToDelay) {
        this.unsafeToContinue = true;
      }
    } else if (!this.isDisposed) {
      callback(false);
    }
  }
  handleQueuedEvents(dontDelayFutureEvents = false) {
    while (!this.isDisposed && this.queuedEvents && this.queuedEvents.length > 0) {
      this.queuedEvents[0](true);
      this.queuedEvents.splice(0, 1);
    }
    if (dontDelayFutureEvents) {
      this.isDelayingEvents = false;
    }
  }
  resetEventQueue() {
    if (this.queuedEvents) {
      this.queuedEvents = [];
    }
    this.unsafeToContinue = false;
  }

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    this.queuedEvents = [];
    this.unsafeToContinue = false;
  }

  get isDelayingEvents() {
    return Boolean(this.queuedEvents);
  }
  set isDelayingEvents(value) {
    value = Boolean(value);
    if (this.isDelayingEvents === value) {
      return;
    }

    this.queuedEvents = value ? [] : null;
    this.unsafeToContinue = false;
  }

  get isDisposed() {
    return this._isDisposed;
  }
}

// #endregion Delays


// #region Disposables

/**
 * Track disposables and allow for disposing of them all.
 * 
 * @class DisposableCollection
 */
class DisposableCollection {

  /**
   * Creates an instance of DisposableCollection.
   * @param {Object|Array} initialDisposables Disposable object(s) that will be added to the collection.
   * @memberof DisposableCollection
   */
  constructor(initialDisposables) {
    Object.assign(this, {
      _isDisposed: false,
      _trackedDisposables: [],
      _disposedEvents: new Map(),

      _onDisposed: new EventManager(),
    });

    this.trackDisposables(initialDisposables);
  }

  /**
   * Add a disposable object to the collection. It will be disposed of when the collection is disposed.
   * 
   * @param {Object|Array} disposables The object(s) to add to the collection.
   * @memberof DisposableCollection
   */
  trackDisposables(disposables) {
    if (!disposables) {
      return;
    }
    if (!Array.isArray(disposables)) {
      disposables = [disposables];
    }
    for (let disposable of disposables) {
      if (!disposable) {
        continue;
      }
      if (Array.isArray(disposable)) {
        this.trackDisposables(disposable);
        continue;
      }
      if (this.isDisposed) {
        DisposableCollection.disposeOfObject(disposable);
        continue;
      }
      if (DisposableCollection.checkIfDisposed(disposable)) {
        continue;
      }

      if (!this._trackedDisposables.includes(disposable)) {
        this._trackedDisposables.push(disposable);

        let callback = () => {
          this.untrackDisposables(disposable);
        };
        for (let eventName of DisposableCollection.onDisposedEventNames) {
          let listener = DisposableCollection.subscribeEvent(disposable, eventName, callback);
          if (listener) {
            this._disposedEvents.set(disposable, listener);
          }
        }
      }
    }
  }

  /**
   * Remove an object from the collection. The object will no longer be disposed when the collection is disposed.
   * 
   * @param {Object|Array} disposables The object(s) to remove from the collection.
   * @memberof DisposableCollection
   */
  untrackDisposables(disposables) {
    if (this.isDisposed) {
      return;
    }
    if (!disposables) {
      return;
    }
    if (!Array.isArray(disposables)) {
      disposables = [disposables];
    }
    // trackedDisposables = trackedDisposables.filter(disposable => !disposables.includes(disposable));
    for (let disposable of disposables) {
      if (!disposable) {
        continue;
      }
      if (Array.isArray(disposable)) {
        this.untrackDisposables(disposable);
        continue;
      }
      while (true) {
        let index = this._trackedDisposables.indexOf(disposable);
        if (index < 0) {
          break;
        }
        this._trackedDisposables.splice(index, 1);
      }

      let listener = this._disposedEvents.get(disposable);
      if (listener) {
        listener.close();
        this._disposedEvents.delete(disposable);
      }
    }
  }

  /**
   * The disposable objects tracked by the collection.
   * 
   * @readonly
   * @memberof DisposableCollection
   */
  get array() {
    return this._trackedDisposables.slice();
  }

  /**
   * Dispose of all object in the collection without disposing the collection itself.
   * 
   * @memberof DisposableCollection
   */
  disposeOfAllObjects() {
    let disposables = Array.from(this._trackedDisposables);
    this.untrackDisposables(disposables);
    for (let disposable of disposables) {
      try {
        DisposableCollection.disposeOfObject(disposable);
      } catch (error) {
        console.error('Failed to dispose of object.', '\nObject: ', disposable, '\nError: ', error, '\nStack Trace:\n', error.stack);
      }
    }
  }

  /**
   * Dispose of the collection and all the object tracked by it.
   * 
   * @memberof DisposableCollection
   */
  dispose() {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    this.disposeOfAllObjects();
    this._trackedDisposables = [];
    this._disposedEvents.clear();
    this._onDisposed.fire(this);
  }


  get isDisposed() {
    return this._isDisposed;
  }

  get onDisposed() {
    return this._onDisposed.subscriber;
  }


  static subscribeEvent(obj, eventName, callback) {
    if (obj[eventName] && obj[eventName].addListener && typeof obj[eventName].addListener === 'function') {
      return new EventListener(obj[eventName], callback);
    }
    return null;
  }
  static callFunction(obj, functionName) {
    if (obj[functionName] && typeof obj[functionName] === 'function') {
      obj[functionName]();
      return true;
    }
    return false;
  }
  static checkIfDisposed(obj) {
    for (let propertyName of DisposableCollection.isDisposedPropertyNames) {
      let inverted = false;
      if (propertyName.startsWith('!')) {
        propertyName = propertyName.substr(1);
        inverted = true;
      }
      let value = obj[propertyName];
      if (value) {
        if (inverted) {
          return false;
        }
        return true;
      }
      if (value !== undefined) {
        break;
      }
    }
    return false;
  }
  static disposeOfObject(obj) {
    for (let disposeFunctionName of DisposableCollection.disposeFunctionNames) {
      if (DisposableCollection.callFunction(obj, disposeFunctionName)) {
        break;
      }
    }
  }
}
Object.assign(DisposableCollection, {
  disposeFunctionNames: [
    'dispose',
    'close',
    'stop',
    'cancel',
  ],
  onDisposedEventNames: [
    'onDisposed',
    'onClosed',
    'onStoped',
    'onCanceled',
    'onDispose',
    'onClose',
    'onStop',
    'onCancel',
  ],
  isDisposedPropertyNames: [
    'isDisposed',
    '!isActive',
  ],
});


/**
 * Delay the creation of disposables.
 * 
 * @class DisposableCreators
 */
class DisposableCreators {

  constructor() {
    Object.assign(this, {
      _isDisposed: false,

      disposableCollection: null,
      disposableCreators: [],
    });
  }

  /**
   * Handle a disposable object returned from a callback.
   * 
   * @param {any} createCallback A callback that returns a disposable object. The first arg is a Boolean that is true if the callback was delayed.
   * @memberof DisposableCreators
   */
  createDisposable(createCallback) {
    if (this.isDisposed || !createCallback || typeof createCallback !== 'function') {
      return;
    }
    this.disposableCreators.push(createCallback);
    if (this.disposableCollection) {
      this.disposableCollection.trackDisposables(createCallback(false));
    }
  }

  /**
   * Call all callbacks to create the disposables.
   * 
   * @memberof DisposableCreators
   */
  start() {
    if (this.isDisposed) {
      return;
    }
    if (!this.disposableCollection) {
      let collection = new DisposableCollection();
      collection.onDisposed.addListener(() => {
        if (this.disposableCollection === collection) {
          this.disposableCollection = null;
        }
      });
      this.disposableCollection = collection;
      collection.trackDisposables(this.disposableCreators.map((callback) => callback(true)));
    }
  }

  /**
   *  Dispose of all tracked disposables.
   * 
   * @memberof DisposableCreators
   */
  stop() {
    if (this.disposableCollection) {
      this.disposableCollection.dispose();
    }
  }

  /**
   * Dispose of all tracked disposables and prevent any more from being created.
   * 
   * @memberof DisposableCreators
   */
  dispose() {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    this.disposableCreators = [];
    this.disposableCollection = null;
  }

  /**
   * Is delaying the creation of any new disposables for later.
   * 
   * @readonly
   * @memberof DisposableCreators
   */
  get isDelaying() {
    return !this.isStarted;
  }

  /**
   * Creators have been called and any new creaters will be created immediately.
   * 
   * @readonly
   * @memberof DisposableCreators
   */
  get isStarted() {
    return Boolean(this.disposableCollection);
  }

  get isDisposed() {
    return this._isDisposed;
  }
}

// #endregion Disposables


// #region Connections

class PortManager {
  constructor() {
    Object.assign(this, {
      _isDisposed: false,
      _onDisposed: new EventManager(),

      _onMessage: new EventManager(),

      _disposables: new DisposableCollection(),
      _ports: new DisposableCollection(),
    });

    this._disposables.trackDisposables([
      this._ports,
      new EventListener(browser.runtime.onMessage, (message, sender) => this._handleMessage(message, sender)),
      new EventListener(browser.runtime.onConnect, (port) => this._ports.trackDisposables(new PortConnection(port))),
    ]);
  }

  getPortById(portId) {
    for (let port of this.openPorts) {
      if (port.id === portId) {
        return port;
      }
    }
    return null;
  }

  fireEvent(eventName, args = []) {
    for (let port of this.openPorts) {
      port.fireEvent(eventName, args);
    }
  }

  async _handleMessage(message, sender) {
    let port = this.getPortById(message.portId);

    let disposables = new DisposableCollection();
    if (port) {
      port._operations.trackDisposables(disposables);
    }

    let messageReturns = this._onMessage.fire(message, sender, disposables, this);
    let firstDefined;
    for (let value of messageReturns) {
      if (value) {
        firstDefined = value;
        break;
      }
      if (firstDefined === undefined) {
        firstDefined = value;
      }
    }
    try {
      await firstDefined;
    } catch (error) {
      console.error('Error on async runtime message handling\n', error, '\nStack Trace:\n', error.stack);
    }
    disposables.dispose();
    return firstDefined;
  }

  // #region Dispose

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this._disposables.dispose();
    this._onDisposed.fire(this);
  }

  get isDisposed() {
    return this._isDisposed;
  }
  get onDisposed() {
    return this._onDisposed.subscriber;
  }

  // #endregion Dispose

  get openPorts() {
    return this._ports.array;
  }
  get onMessage() {
    return this._onMessage.subscriber;
  }
}


class PortConnection {
  constructor(port = null) {
    if (!port) {
      port = browser.runtime.connect({ name: PortConnection.getUniqueId() });
    }

    Object.assign(this, {
      _isDisposed: false,
      _onDisposed: new EventManager(),

      _onPortEvent: new EventManager(),
      _passthroughEventNameLookup: new Map(),
      _subscribedEventNames: [],          // Name of events that will be sent to this port.
      _listeningEventNames: [],           // Name of events that are requested from this port. Message should be sent with data from these events.

      _port: port,
      _operations: new DisposableCollection(),
    });

    // #region Dispose

    if (port.error) {
      this._dispose(true);
      return;
    }
    port.onDisconnect.addListener(() => this._dispose(true));
    this._operations.onDisposed.addListener(() => this.dispose());

    // #endregion Dispose


    port.onMessage.addListener((message) => this._handleMessage(message));
    this._onPortEvent.onChanged.addListener((manager, listener, added) => this._handleSubscribedEventsChanged(listener, added));
  }

  _handleMessage(message) {
    if (!message) {
      return;
    }
    switch (message.type) {
      case PortConnection.messageTypes.eventData: {
        this._onPortEvent.fire(message);
      } break;
      case PortConnection.messageTypes.eventSubscribe: {
        this._listeningEventNames = message.subscribeEventNames;
      } break;
    }
  }

  _handleSubscribedEventsChanged(listener, added) {
    if (this.isDisposed) {
      return;
    }
    let changed = false;
    let subscribed = this._getSubscribedEventNames();
    if (
      subscribed.some(shouldSub => !this._subscribedEventNames.includes(shouldSub)) ||  // Any new event names?
      this._subscribedEventNames.some(subed => !subscribed.includes(subed))             // Any removed event names?
    ) {
      this._subscribedEventNames = subscribed;
      changed = true;
    }
    if (changed) {
      this._port.postMessage({ type: PortConnection.messageTypes.eventSubscribe, subscribeEventNames: this._subscribedEventNames });
    }
  }

  sendMessageBoundToPort(message) {
    message.portId = this.id;
    return browser.runtime.sendMessage(message);
  }

  fireEvent(eventName, args) {
    if (this.isDisposed) {
      return;
    }
    if (this._listeningEventNames.includes(eventName)) {
      this._port.postMessage({ type: PortConnection.messageTypes.eventData, eventName: eventName, eventArgs: args });
    }
  }

  getEvent(eventName) {
    let event = EventManager.createPassthroughEventManager(
      this._onPortEvent,
      (returnedValues) => {
        return false;
      },
      (args) => {
        if (args.length === 0) {
          return false;
        }
        let message = args[0];
        if (message.type !== PortConnection.messageTypes.eventData || message.eventName !== eventName) {
          return false;
        }
        return message.eventArgs || [];
      }
    );
    this._passthroughEventNameLookup.set(event, eventName);
    return event;
  }

  getListeningEventNames() {
    return this._listeningEventNames;
  }
  getSubscribedEventNames() {
    return this._subscribedEventNames;
  }

  _getSubscribedEventNames() {
    return Array.from(this._passthroughEventNameLookup.keys()).filter(event => event.listenersLength > 0).map(event => this._passthroughEventNameLookup.get(event));
  }


  // #region Dispose

  _dispose(portDisconnected = false) {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    if (!portDisconnected) {
      this._port.disconnect();
    }
    this._passthroughEventNameLookup.clear();
    this._subscribedEventNames = [];
    this._listeningEventNames = [];

    this._operations.dispose();
    this._onDisposed.fire(this);
  }
  dispose() {
    this._dispose(false);
  }

  get isDisposed() {
    return this._isDisposed;
  }
  get onDisposed() {
    return this._onDisposed.subscriber;
  }

  // #endregion Dispose


  get id() {
    return this._port.name;
  }

  static getUniqueId() {
    // print random number in base 36
    return 'id-' + Math.random().toString(36).substr(2, 16);
  }
}
Object.assign(PortConnection, {
  messageTypes: Object.freeze({
    eventSubscribe: 'event-subscribe',
    eventData: 'event-data',
  }),
});

// #endregion Connections


class ToolbarPermissionRequest {
  /**
   * Creates an instance of ToolbarPermissionRequest.
   * 
   * @param {Object} permission The permission to request. False values will cancel the current request.
   * @param {any} [pageActionTabId=null] Provide a tabId to use pageAction instead of browserAction.
   * @memberof ToolbarPermissionRequest
   */
  constructor(permission, pageActionTabId = null) {
    Object.assign(this, {
      _permission: permission,
      _pageActionTabId: pageActionTabId,

      _clickListener: null,
      _closed: false,
      _onClosed: new EventManager(),
      _promiseWrapper: new PromiseWrapper(),
    });

    this.start = this._start();
  }

  async _start() {
    await this._abortPrevious();
    this.done = this._handleCompleted();
    this.start = this._makeRequest();
  }

  async _abortPrevious() {
    while (ToolbarPermissionRequest.lastRequest) {
      let currentRequest = ToolbarPermissionRequest.lastRequest;
      currentRequest.close();
      try {
        await currentRequest.done;
      } catch (error) { }
      if (currentRequest === ToolbarPermissionRequest.lastRequest) {
        ToolbarPermissionRequest.lastRequest = null;
      }
    }
    ToolbarPermissionRequest.lastRequest = this;
  }

  async _handleCompleted() {
    let waitError = null;
    try {
      await this._promiseWrapper.getValue();
    } catch (error) { waitError = error; }
    this.close();
    try {
      if (this.useBrowserAction) {
        await browser.browserAction.setBadgeText({ text: '' });
        await browser.browserAction.setPopup({ popup: null });
      } else {
        await browser.pageAction.hide(this._pageActionTabId);
      }
    } finally {
      if (this === ToolbarPermissionRequest.lastRequest) {
        ToolbarPermissionRequest.lastRequest = null;
      }
    }
    if (waitError) {
      throw waitError;
    }
    return true;
  }

  async _makeRequest() {
    try {
      if (!this._permission) {
        this.close();
        return;
      }
      let actions;
      if (this.useBrowserAction) {
        actions = [
          () => browser.browserAction.setPopup({ popup: '' }),
          () => browser.browserAction.setBadgeText({ text: '!' }),
        ];
      } else {
        actions = [
          () => browser.pageAction.show(this._pageActionTabId),
        ];
      }

      for (let action of actions) {
        if (this.isClosed) {
          break;
        }
        await action();
      }
      if (!this.isClosed) {
        if (this.useBrowserAction) {
          this._clickListener = new EventListener(browser.browserAction.onClicked, (tab) => this._handleClick());
        } else {
          this._clickListener = new EventListener(browser.pageAction.onClicked, (tab) => this._handleClick());
        }
      }
    } catch (error) {
      this._promiseWrapper.reject(error);
    }
  }


  async _handleClick() {
    if (this.isClosed) {
      return;
    }
    try {
      await browser.permissions.request(this._permission);
      this._promiseWrapper.resolve(true);
    } catch (error) {
      this._promiseWrapper.reject(error);
    }
  }


  // #region Dispose

  dispose() {
    this.close();
  }
  close() {
    if (this._closed) {
      return;
    }
    this._closed = true;
    if (this._clickListener) {
      this._clickListener.close();
      this._clickListener = null;
    }
    if (!this._permission) {
      this._promiseWrapper.resolve(false);
    } else {
      this._promiseWrapper.reject(new Error('Request canceled.'));
    }
    this._onClosed.fire(this);
  }

  get isDisposed() {
    return this.isClosed;
  }
  get isClosed() {
    return this._closed;
  }

  get onDisposed() {
    return this.onClosed;
  }
  get onClosed() {
    return this._onClosed.subscriber;
  }

  // #endregion Dispose

  /**
   * A promise that will be resolved with true if the permission is changed, false if the permission isn't changed or rejected if the request is canceled.
   * 
   * @readonly
   * @memberof ToolbarPermissionRequest
   */
  get result() {
    return this._promiseWrapper.promise;
  }
  get useBrowserAction() {
    return !this._pageActionTabId && this._pageActionTabId !== 0;
  }
  get isWaitingForUserInput() {
    return Boolean(this._clickListener);
  }
}
