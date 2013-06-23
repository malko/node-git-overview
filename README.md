node-git-overview
=================


Node git overview is a little node script quickly wrote to assist in our daily job where we deal with around 50 git repositories. This is not a perfect tool or finished one but it's proven to be helpful in getting a quick overview of our repositories status.

It is suited for a particular way of working with git which is relatively widespread, basically: a *production* branch (usually master) and a *feature* branch. In such configuration the *feature* branch is often used for continuous integration.

This will display which of the other branches are integrated in the *feature* branch but are not already part of the *production* branch. It will also display for each other branch than *production* and *feature*  
two buttons which will be green or red, green if all commits of the given branch are integrated in the corresponding *production or feature* branch and red if some commits **appears** missing. I precise **appear** missing as it will also be red if there was a conflict at merge time as in such case the patches applied are not those originally contained in the branch and so won't appear as merged when issuing a ```git cherry -v```

Installation
------------
- have a working nodejs installation
- clone this repository ```$ git clone git@github.com:malko/node-git-overview.git```
- cd to your working copy ```cd node-git-overview```
- install node dependencies ```npm install```
- create your *repositories-config.json* (see configuration section below) 
- start the service ```./service.sh```
- open http://127.0.0.1:8000 with your browser

(note you can change listening port and address by calling service.sh with ip and port as first and second parameters: ```./service.sh 127.0.0.1 8000```)

Configuration
-------------
Here is a sample *repositories-config.json* create one at the root or your working copy and add as many repo as you wish
```javascript
{
	/* key will be used as DOM ids so avoid using anything else than [a-zA-z_0-9] for naming*/
	'internalRepoName': {
		label: 'My App name', /* this is the displayed name*/
		path:'/home/git/overview-clones/myAppClone', /* path to the local repository you should **never** use a work copy clone but a **dedicated clone** instead */
		upstream: 'origin', /* you will probably always use origin */
		prod: 'master', /* this is the name of your production branch (must be present on upstream) */
		feature: 'dev', /* this is the name of your continuous integration branch (must be present on upstream) */
	}
	/* add as many entry as you need */
}
```
