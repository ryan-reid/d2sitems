This is a .net program that creates json descriptions of what is inside diablo 2 save files.

The purpose is to make it easier to search for specific items across all your saves/mules.

For Sets, Runewords and Uniques, it calculates a "Perfection Score" - that rates how well the item does in it's stats that have a range.
It does not take the base defense of armor into account, but it does take enhanced defense into account.  It does not weight the value of different stats.  This score might not match what we humans value in items, but it should detect perfect/anti-perfect items and gives a very rough estimate on how good it is.



How to install/use.



Download and install the .net 10.0 or higher sdk for your computer.

- https://dotnet.microsoft.com/en-us/download/dotnet/10.0

Download and install Python on your computer

- https://www.python.org/downloads/windows/



Clone/download this repo

- git clone https://github.com/hombrent/d2sitems
- cd d2sitems

I do not think you actually need to install the D2SSharp Library or if it happens automatically for you, but if you do need to:

- dotnet add package D2SSharp

We need some game files to interpret the saves.  You are going to need to extract the files.
Use the D2RExtractor tool at https://github.com/levinium/D2RExtractor
By default, the tool will look in the default game location to find unpacked game files.

You can specify the location of an "excel" directory with the --excel parameter, to parse files for a mod.
If you are using a mod and specifying an alternative excel directory, be sure to also update the saved games location

Settings can be configured in d2sitems.conf.  The defaults should work for standard installations of D2R.




To run on all of your saved games in the default saved game location ( C:\Users\YourUsername\Saved Games\Diablo II Resurrected) :

- dotnet run 

To run on all files in an alternative location:

- dotnet run directory\path

You can run this on your entire directory periodically - it will overwrite the old files to represent the currrent contents of your characters



To build a new exe file that can be run directly, you can run:

- dotnet publish -r win-x64 -c Release /p:PublishSingleFile=true --self-contained true

Then copy bin/Release/net10.0/win-x64/d2sitems.exe to the main directory or wherever you want it.  You don't need to do this - you can just use the dotnet command to automtically compile and run the program for you each time.




To run on all of your saved games in the default saved game location ( C:\Users\YourUsername\Saved Games\Diablo II Resurrected) :

- dotnet run 

You can run this on your entire directory periodically - it will overwrite the old files to represent the current contents of your characters


You can search for items with the find_items.py script.

- .\find_item.py --help

Read the help message to see all the search parameters.  You can search for specific items, item types, ethereal items, socketed items, rare items, etc.


Alternatively, you can use whatever json or search tools you want to search for items.


You can have the tool monitor your save file in realtime and every time you identify a set/unique item, it will search all your characters for that item and notify you if you already have it.  

- dotnet run --monitor CharacterName

It prints information about the object to the dos prompt window, including ranges for all the rolled stats.  You can configure it to beep or speak to you if this is a new item that you haven't found yet.  You can have it beep or speak to you if this is the best version of this item that you have found so far.  Speaking and beeping is set up in the config file.


It is quite annoying finding the character that you want to pull an item off of in your 200 mules.  So, we have the concept of muling and fetching.

- .\mule.py charname 

This will move all of the files for this character into a mules directory (configured in d2sitems.conf) to get this character out of the way.  Searches will still find items that are on your mules.

- .\fetch.py charname 

This will retrieve the character from the mules directory and restore it into your main saved games directory.  If it is already in your saved_games directory, it will update the datetime on the file to bring it to the top of the list.

The D2R client does not go to disk to update the list of characters that it has in memory.  In order to get an updated character list, you must exit the game and relaunch it.

- .\fetch.py --sort

This updates the last modified time for all the saved games - so that they show up in alphabetical order.  This is to make it easier to find mules in your character list inside the D2R game.  It leaves the most recently played character at the top.  It also treats written numbers as numbers.  For example, MuleTwo will come before MuleFive.  You will need to restart the game to see the updated character order

You can also view your grail status by runing .\find-item.py --grail

d2s save files are not edited or changed in any way.  We just read them and create extra files for fast searching.  I had tried another solution in the past that kept items in a database, but changes to the game and changes to the app corrupted the database and I lost all my items.  The design philosophy here is to leave the save files intact - only edit and change them with the game to be safe.  But build tools around the game to make managing items and mules easier.



This uses the D2SSharp project. Thanks to ResurrectedTrader.  https://github.com/levinium/D2RExtractor

This is vibe coded using claude.



This is to serve as note to self.  I don't yet know how to build a working standalone exe file.
    To build a new exe file that can be run directly, you can run:
    - dotnet publish -r win-x64 -c Release /p:PublishSingleFile=true --self-contained true
    Then copy bin/Release/net10.0/win-x64/d2sitems.exe to the main directory or wherever you want it.

