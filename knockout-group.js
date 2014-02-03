(function(global, undefined) {
    'use strict';
  
    function insertSorted(array, item, compareFunction) {
        var m = Math.floor(array.length / 2), 
            hi = array.length, 
            lo = 0;
      
        if (!compareFunction) {
            compareFunction = function(a, b) {
                if (a > b) {
                    return 1;
                } else if (a < b) {
                    return -1;
                }
                return 0;
            };
        }
      
        do {
            var compare = compareFunction(item, array[m]);
            if (compare > 0) {
                lo = m + 1;
            } else if (compare < 0) {
                hi = m;
            } else {
                break;
            }
        
            m = Math.floor(lo + ((hi - lo) / 2));
        } while (lo < hi);
      
        array.splice(m, 0, item);
        return m;
    }
  
    function Hashtable(ko, compareFunction) {
        // Buckets are a pseudo-hashmap to speed up access...
        // Implement toString on object key types if you want efficiency!
        this.ko = ko;
        this.buckets = {};
        this.all = ko.observableArray([]);
        this.compareFunction = compareFunction;
         
        if (!this.compareFunction) {
            this.compareFunction = function() { return -1; }; // Default inserts to first position
        }
    }
  
    Hashtable.prototype.getBucketKey = function(key) {
        if (typeof key === 'object') {
            key = "" + key; 
        }
        return key;
    };
  
    Hashtable.prototype.getBucket = function(key) {
        return this.buckets[this.getBucketKey(key)];
    };
  
    Hashtable.prototype.get = function(key) {
        var bucket = this.getBucket(key);
        if (bucket) {
            return bucket.get(key);
        }
    };
  
    Hashtable.prototype.put = function(key, value, metadata) {
        var bucket = this.getBucket(key);
        if (!bucket) {
            bucket = this.buckets[this.getBucketKey(key)] = new Bucket(this.ko, this.all, this.compareFunction);
        }
        return bucket.put(key, value, metadata);
    };
  
    Hashtable.prototype.remove = function(key) {
        var bucket = this.getBucket(key);
        if (bucket && bucket.remove(key)) {
            if (!bucket.contents.length) {
                this.buckets[this.getBucketKey(key)] = null;
            }
            return true;
        }
    };
  
    function Bucket(ko, all, compareFunction) {
        this.ko = ko;
        this.all = all;
        this.compareFunction = compareFunction;
        this.contents = [];
    }
  
    Bucket.prototype.get = function(key) {
        var result;
        this.contents.some(function(content) {
            var match = content.key === key;
            if (match) {
                result = content;
            }
            return match;
        });
        return result;
    };
  
    Bucket.prototype.put = function(key, value, metadata) {
        // Using metadata is optional. If not specified, use value for both.
        if (!metadata) {
            metadata = value;
        }
      
        var existing = this.get(key);
        if (existing) {
            var index = insertSorted(existing.metadata, metadata, this.compareFunction);
            existing.values.splice(index, 0, value);
            return index;
        } else {
            existing = {
                key: key,
                metadata: [metadata],
                values: this.ko.observableArray([value])
            };
            this.contents.push(existing);
            this.all.push(existing);
            return 0;
        }
    };
  
    Bucket.prototype.remove = function(key) {
      var removeFromArray = function(array, item) {
        return array.some(function(entry, index, array) {
          var match = item == entry.key;
          if (match) {
            array.splice(index, 1);
          }
          return match;
        }); 
      };

      var removed = removeFromArray(this.contents, key);
      if (removed) {
        if (removeFromArray(this.all(), key)) {
          this.all.valueHasMutated();
        }
      }
      return removed; 
    };
  
    function StateItem(ko, originalArrayIndex, value, diffProcessor) {
        this.diffProcessor = diffProcessor;
      
        this.originalArrayIndex = originalArrayIndex;
        this.outputGroup = null;
        this.outputArrayIndex = -1;
      
        this.rawValue = value;
        this.valueComputed = ko.computed(ko.utils.unwrapObservable.bind(undefined, value));
        this.valueComputed.subscribe(this.onValueChanged, this);
        this.value = this.valueComputed.peek();
    }
  
    StateItem.prototype.dispose = function() { 
        this.valueComputed.dispose();
    };
  
    StateItem.prototype.onValueChanged = function(newValue) {
        if (newValue !== this.value) {
            this.diffProcessor([
                {index: this.originalArrayIndex, status: 'deleted'},
                {index: this.originalArrayIndex, status: 'added', value: this.rawValue}
            ]);
        }
    };
                                            
    function processArrayDiff(ko, inputObservableArray, stateArray, outputTable, groupByFunction, diff) {
        if (!diff.length) {
            return;
        }
      
        var deleteCount = 0;
        var insertCount = 0; 
        var lastDeleteGroup = null;
        var lastDeleteIndex = -1;
        var lastDeleteValue = null;
        var lastInsertGroup = null;
        var lastInsertIndex = -1;
        var lastInsertValue = null;
     
        for (var diffIndex = 0; diffIndex < diff.length; diffIndex++) {
            var diffEntry = diff[diffIndex];
            if (diffEntry.status === 'added') {
              
                // Update original array indicies, it is implied that an add pushes everything after that down the line
                for (var i = 0; i < stateArray.length; i++) {
                    if (stateArray[i].originalArrayIndex >= diffEntry.index) {
                        stateArray[i].originalArrayIndex++;
                    }
                }
                // Make new item, and insert it into our table
                // This requires passing a reference to this pseudo-curried function, which the only way I
                // know how to get a reference to is to re-curry it.
                var diffProcessor = processArrayDiff.bind(undefined, ko, inputObservableArray, stateArray, outputTable, groupByFunction);
                var result = insertGroupedStateItem(stateArray, new StateItem(ko, diffEntry.index, diffEntry.value, diffProcessor), outputTable, groupByFunction);
              
                // Save info on what action we performed for this diff entry
                lastInsertGroup = result.group;
                lastInsertIndex = result.index;
                lastInsertValue = diffEntry.value;
                insertCount++;
              
            } else if (diffEntry.status === 'deleted') {
              
                // Find it by index
                // As an opimization, we could jump into the outputTable here and walk the metadata set... TODO
                for (var j = 0; j < stateArray.length; j++) {
                    // Delete when index matches
                    if (stateArray[j].originalArrayIndex === diffEntry.index) {
                      
                        // Note the action we're preforming for this diff entry
                        lastDeleteGroup = stateArray[j].outputGroup;  
                        lastDeleteIndex = stateArray[j].outputArrayIndex;
                        lastDeleteValue = stateArray[j].rawValue;
                        deleteCount++;
                        
                        // Remove it from everywhere we have reference, making sure to cleanup with dispose()
                        var outputGroupSet = outputTable.get(lastDeleteGroup);
                        outputGroupSet.values.splice(lastDeleteIndex, 1);
                        outputGroupSet.metadata.splice(lastDeleteIndex, 1);
                        if (outputGroupSet.values().length === 0) {
                            outputTable.remove(lastDeleteGroup);
                        }
                        stateArray[j].dispose();
                        stateArray.splice(j, 1);
                        
                        // Bail
                        break;
                    } 
                }
              
                // Go through again, updating the output array index now that we have the group and index we
                // deleted at. Can't do it during the above loop, because we get that info midway through.
                for (var k = 0; k < stateArray.length; k++) {
                    if (stateArray[k].outputGroup === lastDeleteGroup && stateArray[k].outputArrayIndex > lastDeleteIndex) {
                        stateArray[k].outputArrayIndex--;
                    }
                    // Also update original array indicies, it is implied that a delete moves everything after that up
                    if (stateArray[k].originalArrayIndex > diffEntry.index) {
                        stateArray[k].originalArrayIndex--;
                    }
                }
            }
        }

        if (insertCount > 0 || deleteCount > 0) {
            // Special case check: if removed and inserted the same thing in the same spot, ignore
            // This happens whenever an entry's value is updated, but doesn't cause it to be sorted in a new spot
            if (insertCount !== 0 || deleteCount !== 0 || 
                lastInsertIndex !== lastDeleteIndex || 
                lastDeleteValue !== lastInsertValue ||
                lastInsertGroup !== lastDeleteGroup) {
                // TODO need to raise on the child sets, and only on the "all" set if changed groups
                outputTable.all.valueHasMutated();
            } else {
                // Didn't actually do anything!
            }
        }
    }
  
    function insertGroupedStateItem(stateArray, stateItem, outputTable, groupByFunction) {
        var group = groupByFunction(stateItem.value);
        stateItem.outputGroup = group;
        stateItem.outputArrayIndex = outputTable.put(group, stateItem.valueComputed, stateItem);
        for (var i = 0; i < stateArray.length; i++) {
            if (stateArray[i].outputGroup === group && stateArray[i].outputArrayIndex >= stateItem.outputArrayIndex) {
                stateArray[i].outputArrayIndex++;
            }
        }
        stateArray.push(stateItem);
        return {group: group, index: stateItem.outputArrayIndex};
    }
  
    function compareOriginalIndex(a, b) {
        if (a.originalArrayIndex > b.originalArrayIndex) return 1;
        if (a.originalArrayIndex < b.originalArrayIndex) return -1;
        return 0;
    }
  
    function observableArrayGroup(ko, groupByFunction) {
        var inputArray = this.peek(),
            inputObservableArray = this,
            stateArray = [],
            outputTable = new Hashtable(ko, compareOriginalIndex);
      
        // If the input array changes structurally (items added or removed), update the outputs
        var diffProcessor = processArrayDiff.bind(undefined, ko, inputObservableArray, stateArray, outputTable, groupByFunction);
        var inputArraySubscription = inputObservableArray.subscribe(diffProcessor, null, 'arrayChange');

        // Build output by inserting each item in its sorted position
        for (var i = 0; i < inputArray.length; i++) {
            insertGroupedStateItem(stateArray, new StateItem(ko, i, inputArray[i], diffProcessor), outputTable, groupByFunction);
        }
      
        // Return value is a readonly computed which can track its own changes to permit chaining.
        // When disposed, it cleans up everything it created.
        var returnValue = ko.computed(outputTable.all).extend({ trackArrayChanges: true }),
            originalDispose = returnValue.dispose;
        returnValue.dispose = function() {
            inputArraySubscription.dispose();
            ko.utils.arrayForEach(stateArray, function(stateItem) {
                stateItem.dispose();
            });
            originalDispose.call(this, arguments);
        };

        // Make projections chainable
        addProjectionFunctions(ko, returnValue);

        return returnValue;
    }

    // Attaching projection functions
    // ------------------------------
    //
    // Builds a collection of projection functions that can quickly be attached to any object.
    // The functions are predefined to retain 'this' and prefix the arguments list with the
    // relevant 'ko' instance.

    var projectionFunctionsCacheName = '_ko.projections.cache';

    function attachProjectionFunctionsCache(ko) {
        // Wraps callback so that, when invoked, its arguments list is prefixed by 'ko' and 'this' 
        function makeCaller(ko, callback) {
            return function() {
                return callback.apply(this, [ko].concat(Array.prototype.slice.call(arguments, 0)));
            };
        }
        ko[projectionFunctionsCacheName] = {
            group: makeCaller(ko, observableArrayGroup)
        };
    }

    function addProjectionFunctions(ko, target) {
        ko.utils.extend(target, ko[projectionFunctionsCacheName]);
        return target; // Enable chaining
    }

    // Module initialisation
    // ---------------------
    //
    // When this script is first evaluated, it works out what kind of module loading scenario
    // it is in (Node.js or a browser `<script>` tag), and then attaches itself to whichever
    // instance of Knockout.js it can find.

    function attachToKo(ko) {
        attachProjectionFunctionsCache(ko);
        addProjectionFunctions(ko, ko.observableArray.fn); // Make all observable arrays projectable
    }

    // Determines which module loading scenario we're in, grabs dependencies, and attaches to KO
    function prepareExports() {
        if (typeof module !== 'undefined') {
            // Node.js case - load KO synchronously
            var ko = require('knockout');
            attachToKo(ko);
            module.exports = ko;
        } else if ('ko' in global) {
            // Non-module case - attach to the global instance
            attachToKo(global.ko);
        } else if (typeof define === 'function' && define.amd) {
					require(['knockout'],function(ko){
						attachToKo(ko);
					})
				}
 		}
    }

    prepareExports();

})(this);
