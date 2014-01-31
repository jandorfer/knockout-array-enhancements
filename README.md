knockout-array-enhancements
============

Add a couple more options to the knockout observable array: sorting and grouping. Inspired and strongly influenced by [knockout-projections](https://github.com/SteveSanderson/knockout-projections), which should work just fine in concert with this. Though I haven't actually tested that (yet).

Usage
============

Something like:

    var items = ko.observableArray([5, 1, 42, 3]);

    var sorted = items.sort(function(a, b) { 
        if (parseInt(a) > parseInt(b)) return 1;
        if (parseInt(a) < parseInt(b)) return -1;
        return 0;
    });

    console.log(sorted()); 
    // Output 
    // [1, 3, 5, 42]	

    var grouped = items.group(function(item) { 
        return item % 2 === 0 ? "even" : "odd";
    });

    grouped().forEach(function(group) {
        console.log(group.key);
        group.values().forEach(function(value) {
            console.log('\t' + value());
        });
    });
    // Output
    // odd
    //     5
    //     1
    //     3
    // even
    //     42

That's about it.

How the Magic Happens
============

Using the new array change subscriptions in [knockout 3](http://blog.stevensanderson.com/2013/10/08/knockout-3-0-release-candidate-available/)

Warning
============

I am relatively new to javascript, and this has undergone little to no testing. Enjoy!