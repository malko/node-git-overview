
var child_process = require('child_process')
	, fs = require('fs')
	, gravatar = require('gravatar')
	, http = require('http')
	, D = require('./D.js')
	, DEBUG_MODE = true
	, log = function(){
		if( typeof(DEBUG_MODE) !== 'undefined' && DEBUG_MODE ){
			return console.log.apply(console,arguments);
		}
	}
;

// promisify some node functions
var exec = D.nodeCapsule(child_process.exec)
	, readFile = D.nodeCapsule(fs.readFile)
	, readCachedFile = function(file){
		if (DEBUG_MODE) {
			return readFile(file);
		}
		var d=D();
		if (readCachedFile.cached && readCachedFile.cached[file]) {
			d.resolve(readCachedFile.cached[file]);
		} else {
			readFile(file).then(function(data){ d.resolve(readCachedFile.cached[file] = data);console.log(data)},d.reject).rethrow();
		}
		return d.promise;
	}
;

readCachedFile.cached = {};

//first read config file
var repoConfig=null
	, repoStatuses={}
;

/**
* return a promise of updated config read
* @return promise
*/
function updateConfig(){
	var d=D();
	readFile('./repositories-config.json',{encoding:'utf8'})
		.then(function(data){ var tmp = JSON.parse(data.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g,'')); repoConfig = tmp; d.resolve(true);})
		.rethrow(function(err){d.reject(err);log(err);})
		.then(function(){console.log('LOG',arguments)})
	;
	return d.promise;
}

/**
* parse branches part of the log and return a  list of branches as an array
* @param string log part containing the branches
* @param object repoConfig the configuration matching the repository
* @return Array
*/
function parseBranches(str,repoConfig){
	var res=[]
		,exp=new RegExp("(?:Merge(?: remotes?)? branch(?:es)?|,|and)\\s+?'([^']+)'\\s*(?=,|and |into "+repoConfig.testing+")",'g')
		,originExp=new RegExp("^"+repoConfig.upstream+"/")
		,excludeExp=new RegExp("^.*branch '"+repoConfig.testing+"' of.*$",'mg')
	;
	str
		.replace(excludeExp,function(m){ res.push({name:'<b style="color:red">'+m+'</b>'});})
		.replace(exp, function(m,branch){ res.push({name:branch.replace(originExp,'')});})
	;
	//~ log('\nPARSEBRANCHES:\n',str,exp,res,'\n');
	return res;
}
/**
* update a single repository status
* @param string repoName
* @param bool remoteUpdateFirst
* @return promise of object repoStatus
*/
function updateRepoStatus(repoName,remoteUpdateFirst){
	if( repoConfig === null ){ // enforce a config is already read
		return updateConfig().then(function(){ return updateRepoStatus(repoName,remoteUpdateFirst);});
	}
	var conf = repoConfig[repoName];
	if( undefined === conf ){
		var d=D();
		d.reject('invalid repoName ' + repoName);
		return d.promise;
	}
	var cmd ='git log --merges '+conf.upstream+'/'+conf.prod+'..'+conf.upstream+'/'+conf.testing+' --pretty="%cn#%ce#%ct#%s" | grep "into '+conf.testing+'"'
		,cmdOpts = {cwd:conf.path}
		,statusPromise
	;
	if( remoteUpdateFirst ){
		statusPromise=exec('git remote update',cmdOpts).then(function(){ return exec(cmd,cmdOpts);});
	}else{
		statusPromise=exec(cmd,cmdOpts);
	}
	return statusPromise
		.apply(function(stdout,stderr){
			// initialize repoStatus[repoName]
			repoStatuses[repoName] = {name:repoName,label:repoConfig[repoName].label,updateTime:(new Date()).getTime(),merges:[]};
			//~ log('\nSTART '+repoName+'\n',stdout,repoStatuses[repoName],'\n---------------------------\n');
			stdout.replace(/^([^#]+)#([^#]+)#([^#]+)#([^\n]+)/mg,function(m,by,mail,date,branches){
				//log('FEEDING '+repoName+'\n with:'+stdout+'\n',branches,'\n');
				repoStatuses[repoName].merges.push({
					by:by
					,mail:mail
					,gravatar:gravatar.url(mail,{s:32},false)
					,at:date*1000
					,branches:parseBranches(branches,conf)
				});
			});
			repoStatuses[repoName].merges.sort(function(a,b){ return a.at > b.at ? -1 : (a.at===b.at?0:1);});
		})
		.error(function(err){
			repoStatuses[repoName] = {name:repoName,label:repoConfig[repoName].label,updateTime:(new Date()).getTime(),error:err.toString()};
		})
		.then(function(){ return repoStatuses[repoName];})
	;
}

/**
* update all repositories statuses
* @param bool remoteUpdateFirst
* @return promise of object repoStatuses
*/
function updateRepoStatuses(remoteUpdateFirst){
log('updating')
	var promises=[];
	for( var repo in repoConfig ){
		promises.push(updateRepoStatus(repo,remoteUpdateFirst));
	}
	return D.all(promises);
}

// starting the server
updateConfig()
	.then(function(){ updateRepoStatuses(true) })
	.then(function(){
		log('create server',repoConfig)
		http.createServer(function (req, res) {
			//res.writeHead(200, {'Content-Type': 'application/json'});
			log('requesting '+req.url,req.headers);
			var query = req.url.substr(1).split('/')
				,action = query[0]
				,params = query.slice(1)
				,content = null
			;
			switch(action){
				//~ case 'gravatar':
					//~ content = D.promisify(params[0] ? gravatar.url(params[0], {s: '64'}, false) : null);
					//~ break;
				case 'D.js':
					content = readCachedFile('./D.js');
					break;
				case 'getStatuses':
					console.log('GETSTATUSES',params,(params[0] === 'reload'));
					content = (params[0] === 'reload') ? updateRepoStatuses(true).success(function(){ return repoStatuses;}) : repoStatuses;
					break;
				case 'updateConfig':
					updateConfig();
					content = 'done';
					break;
				case 'getStatus':
					console.log(params)
					content = updateRepoStatus(params[0],true);//.success(function(){return repoStatuses[params[0]];});
					content.then('status return;',log,log)
					break;
				case 'serverTime':
					content = (new Date()).getTime()+'';
					break;
				case 'webfonts':
					action = 'webfonts/'+params.join('/').replace(/\?.*$/,'');
					content = readFile('public/'+action);
					break;
				default:
					if( action.match(/^(|index(?:\.html)?|(?:basic-compat|stpl)\.js)$/) ){
						( action ==='' || req.url==='index' ) &&  (action = '/index.html');
						content = readCachedFile('public/'+action);
					}
					break;
			}
			// ensure content is a promise
			if(! (content && content.then) ){
				var d = D();
				d.resolve(content);
				content = d.promise;
			}
			//log('WAITING RESOLVE',action,content);
			content
				.then(
					function(body){
						if( ! body ){
							throw new Error(404);
							return;
						}
						console.log('response',action,params,body,typeof body,body instanceof Buffer);
						if( typeof body === 'string' || (body instanceof Buffer) ){
							action.replace(/\.(js|css|html|htm)$/,function(m,ext){
								var ctype='text/plain';
								(ext==='css') && (ctype='text/css');
								(ext==='js') && (ctype='application/javascript');
								(ext==='html'||ext==='htm') && (ctype='text/html');
								(ext==='manifest') && (ctype='text/cache-manifest');
									res.setHeader("Content-Type",ctype);
								//- if( ext.match(/^(css|js|manifest|woff|html?)$/)){
									//- var expDate = new Date();
									//- expDate.setTime(expDate.getTime()+600000);
									//- res.setHeader('Expires',expDate.toUTCString());
								//- }
							});
							res.writeHeader(200);
							res.write(body);
							res.end();
							//~ log(action + ' response END 200');
						}else{
							res.writeHead(200, {'Content-Type': 'application/json'});
							res.end(JSON.stringify(body));
							//~ log(action + ' response END 200json');
						}
					}
					,function(Err){
						res.writeHead(404, {'Content-Type': 'text/html'});
						res.end('<h1>404</h1> Page unknown\n<br />'+Err);
						//~ log(action + ' response END 404');
					}
				)
				.error(function(err){
					console.log('ERROR>>',err,'<<ERROR')
					res.writeHead(typeof err === 'number' ? err : 500, {"Content-Type": "text/plain"});
					res.write((typeof err !== 'number' ? err : 'Internal Server Error' ) + "\n");
					res.end();
					//~ log(action + ' response END 500');
				})
			;
		}).listen( process.argv[2] || 8000, '127.0.0.1');
		//~ console.log('running',process.argv[2] || 8000);
	})
	.rethrow()
;
return ;
