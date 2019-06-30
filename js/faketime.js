// API for controlling time in JavaScript.
// Makes it possible to run most web applications faster
// or slower than real time.

(function() {

  // Frame rate when time is running "normally".
  var FRAME_RATE = 30;

  function FakeTime() {
    this.animationFrameRate = FRAME_RATE;

    // Used to track virtual time.
    this._startTime = new Date().getTime();
    this._currentTime = this._startTime;

    // Queue of pending virtual timeouts.
    // Each object has keys: 'deadline', 'func', and 'id'.
    this._timers = [];

    // Used to pass time normally when time is not
    // being manipulated.
    this._realtimeTimeout = null;

    // Backups of overridden window functions.
    this._backups = {};

    this._install();
    this.play();
  }

  // Play the application at normal speed.
  FakeTime.prototype.play = function(speed) {
    speed = speed || 1;
    if (this._realtimeTimeout !== null) {
      // Allow re-playing at a different speed.
      this.pause();
    }
    var lastTime = this._realTime();
    var backup = this._backups.setTimeout.bind(window);
    var timePerTick = 1000 / FRAME_RATE;
    var tickFunc = function() {
      this.advance(speed * timePerTick);
      var newTime = this._realTime();
      var elapsed = newTime - lastTime;
      var timeoutTime = Math.max(1, timePerTick-elapsed);
      this._realtimeTimeout = backup.call(window, tickFunc, timeoutTime);
      lastTime = newTime;
    }.bind(this);
    tickFunc();
  };

  // Stop the application from running at normal speed.
  // Time will only advance if advance() is called.
  FakeTime.prototype.pause = function() {
    if (this._realtimeTimeout !== null) {
      this._backups.clearTimeout.call(window, this._realtimeTimeout);
      this._realtimeTimeout = null;
    }
  };

  // Advance the current timestamp.
  FakeTime.prototype.advance = function(millis) {
    this._triggerTimers();
    while (true) {
      var nextTimer = this._nextTimer();
      if (nextTimer === null) {
        break;
      }
      var advance = 1 + (nextTimer.deadline - this._currentTime);
      if (advance > millis) {
        break;
      }
      millis -= advance;
      this._currentTime += advance;
      this._triggerTimers();
    }
    this._currentTime += millis;
  }

  FakeTime.prototype._triggerTimers = function() {
    for (var i = 0; i < this._timers.length; ++i) {
      var timer = this._timers[i];

      // Intentionally avoid using >= so that doing
      //
      //     var f;
      //     f = () => setTimeout(f, 0);
      //
      // doesn't cause an infinite loop.
      if (this._currentTime > timer.deadline) {
        this._timers.splice(i, 1);
        try {
          timer.func();
        } catch (e) {
          console.log('exception in timer', e);
        }
        --i;
      }
    }
  };

  FakeTime.prototype._nextTimer = function() {
    var firstDeadline = -1;
    var firstTimer = null;
    for (var i = 0; i < this._timers.length; ++i) {
      var timer = this._timers[i];
      if (timer.deadline < firstDeadline || firstTimer === null) {
        firstTimer = timer;
        firstDeadline = timer.deadline;
      }
    }
    return firstTimer;
  };

  FakeTime.prototype._install = function() {
    this._backups['performance_now'] = performance.now;

    var overriddenProps = [
      'Date', 'setTimeout', 'setInterval',
      'clearTimeout', 'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame'
    ];
    overriddenProps.forEach(function(prop) {
      this._backups[prop] = window[prop];
    }.bind(this));

    this._installTimeout();
    this._installInterval();
    
    //Disable it because this causes error in Scratch - August
    //this._installDate();

    this._installPerformance();
    this._installAnimationFrame();
  };

  FakeTime.prototype._installTimeout = function() {
    var timeoutID = 0;

    window.setTimeout = function(func, millis) {
      if ('string' === typeof func) {
        func = new Function(func);
      }
      millis = millis || 1;

      var extraArgs = [];
      for (var i = 2; i < arguments.length; ++i) {
        extraArgs.push(arguments[i]);
      }

      this._timers.push({
        func: function() {
          func.apply(window, extraArgs);
        },
        id: ++timeoutID,
        deadline: this._currentTime + millis
      });
      return timeoutID;
    }.bind(this);

    window.clearTimeout = function(id) {
      for (var i = 0, len = this._timers.length; i < len; ++i) {
        var timer = this._timers[i];
        if (timer.id === id) {
          this._timers.splice(i, 1);
          break;
        }
      }
    }.bind(this);
  }

  FakeTime.prototype._installInterval = function() {
    var intervalID = 0;
    var timeouts = {};

    window.setInterval = function() {
      var id = ++intervalID;

      var timeoutArgs = [];
      for (var i = 0; i < arguments.length; ++i) {
        timeoutArgs.push(arguments[i]);
      }

      if ('string' === typeof timeoutArgs[0]) {
        timeoutArgs[0] = new Function(timeoutArgs[0]);
      }

      var tickHandler = timeoutArgs[0];
      timeoutArgs[0] = function() {
        try {
          tickHandler.apply(this, arguments);
        } catch (e) {
          console.log('exception in interval', e);
        }
        // Deal with case where clearInterval is called
        // from within the handler.
        if (timeouts.hasOwnProperty(id)) {
          timeouts[id] = setTimeout.apply(window, timeoutArgs);
        }
      };
      timeouts[id] = setTimeout.apply(window, timeoutArgs);

      return id;
    };

    window.clearInterval = function(id) {
      if (timeouts.hasOwnProperty(id)) {
        clearTimeout(timeouts[id]);
        delete timeouts[id];
      }
    }
  };

  FakeTime.prototype._installDate = function() {
    var faketime = this;
    var RealDate = this._backups.Date;

    function VirtualDate() {
      if (arguments.length === 0) {
        this._date = new RealDate(Math.round(faketime._currentTime));
      } else {
        var bindArgs = [RealDate];
        for (var i = 0; i < arguments.length; ++i) {
          bindArgs.push(arguments[i]);
        }
        var bound = RealDate.bind.apply(RealDate, bindArgs);
        this._date = new bound();
      }
    }

    VirtualDate.now = function() {
      return new VirtualDate().getTime();
    };
    VirtualDate.UTC = function() {
      var res = Object.create(VirtualDate);
      res._date = RealDate.UTC.apply(RealDate, arguments);
      return res;
    };
    VirtualDate.length = RealDate.length;

    var protoNames = Object.getOwnPropertyNames(RealDate.prototype);
    protoNames.forEach(function(name) {
      VirtualDate.prototype[name] = function() {
        return this._date[name].apply(this._date, arguments);
      };
    });

    VirtualDate.prototype.constructor = window.Date;
    window.Date = VirtualDate;
  };

  FakeTime.prototype._installPerformance = function() {
    window.performance.now = function() {
      return this._currentTime;
    }.bind(this);
  };

  FakeTime.prototype._installAnimationFrame = function() {
    // TODO: synchronize all animation frame callbacks to
    // have the same timestamp.
    // This will require some kind of queueing mechanism.

    window.requestAnimationFrame = function(callback) {
      return setTimeout(function() {
        // Yup, for some reason `this` is the callback.
        callback.call(callback, performance.now());
      }, 1000/this.animationFrameRate);
    }.bind(this);
    window.webkitRequestAnimationFrame = window.requestAnimationFrame;
    window.cancelAnimationFrame = function(id) {
      clearTimeout(id);
    }
  };

  FakeTime.prototype._realTime = function() {
    return new this._backups.Date().getTime();
  }

  window.faketime = new FakeTime();

})();
