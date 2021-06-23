module.exports = async function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request.');
    context.log(req);

    // Validate that the request is valid and authorised againt the secret in the Key Vault.

    if (req.headers.authorization === 'Bearer ' + process.env["functiontoken"]) {
        context.log("Bearer token accepted");
    } else {
        context.log("Empty or invalid bearer token");
        context.res.status = 401;
        return;
    }

    //Call the WalkMe authorisation API and get a current auth token.

    const axios = require("axios")
    var qs = require('qs');
    var data = qs.stringify({
      'grant_type': 'client_credentials' 
    });

    const options = {
        headers: { 
            'Authorization': 'Basic ' + process.env["wmcredentials"], 
            'Content-Type': 'application/x-www-form-urlencoded'
        }
      };

    var token_req = await axios.post('https://api.walkme.com/accounts/connect/token', data, options).then(function(response) {
        return response.data;
        }).catch(function(error) {
            return error.response.data;
        });

    auth_token = token_req.access_token;


    //get access roles for matching with App Roles during provisioning
        context.log('Getting access roles');
        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        const access_roles = await axios.get('https://api.walkme.com/public/v1/scim/AccessRoles', options1).then(function(response) {
            return response.data;
            }).catch(function(error) {
                return error.response.data;
            });

    //get all users
    if (req.method === "GET" && Object.keys(req.query).length === 0 && Object.keys(req.params).length === 0) {
        context.log('Is get all users');
        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        var users_req = await axios.get('https://api.walkme.com/public/v1/scim/Users', options1).then(function(response) {
            return response;
            }).catch(function(error) {
                return error.response;
        });

        //Convert the returned user access role IDs into the human readable displayname
        for (const i in users_req.data.Resources) {
            var humanRoleName = access_roles.Resources.filter(item => item.id === users_req.data.Resources[i].accessRole).map(item => item.name);
            users_req.data.Resources[i].accessRoleDisplayName = humanRoleName[0];
        }
        scimifiedResponse = users_req;
    
    };

    //get user by ID
    if (req.method === "GET" && req.params.user_id) {
        context.log('Is get user by ID');
        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        var users_req = await axios.get('https://api.walkme.com/public/v1/scim/Users/' + req.params.user_id, options1).then(function(response) {
            //TODO - return a pseudo-active status based on assigned systems
            // if (response.data.allowedSystems.length === 0) {response.data.active = "False"} else {response.data.active = "True"};
            return response;
            }).catch(function(error) {
                //Thought this was required for proper handling but doesn't look like it  - will remove.
                if (error.response.data.status === 404) {
                    error.response.data.detail = 'Resource ' + req.params.user_id + ' not found';
                }
                return error.response;
            });
        //Convert the returned user access role IDs into the human readable displayname
        var humanRoleName = access_roles.Resources.filter(item => item.id === users_req.data.accessRole).map(item => item.name);
        users_req.data.accessRoleDisplayName = humanRoleName[0];
        scimifiedResponse = users_req;
    
    };    

    //get users by filter
    if (req.method === "GET" && req.query.filter) {
        context.log('Is get users by filter: ' + req.query.filter);
        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        var users_req = await axios.get('https://api.walkme.com/public/v1/scim/Users', options1).then(function(response) {
            context.log(JSON.stringify(response.data))
            return response;
            }).catch(function(error) {
                return error.response;
        });
        
        //Filter the full user list down to just the user(s) that match the filter query
        var filterUserString = req.query.filter.match(/userName.eq.\"(.*)\"/);
        var filtered = users_req.data.Resources.filter(a => a.userName.includes(filterUserString[1]));
        users_req.data.totalResults = filtered.length;
        users_req.data.Resources = filtered;
        for (const i in users_req.data.Resources) {
            //Convert the returned user access role IDs into the human readable displayname
            var humanRoleName = access_roles.Resources.filter(item => item.id === users_req.data.Resources[i].accessRole).map(item => item.name);
            users_req.data.Resources[i].accessRoleDisplayName = humanRoleName[0];
        }
        //TODO - change to a loop incase multiple results and return a pseudo-active status based on assigned systems
        // if (users_req.data.Resources.length === 1) {
        //     if (users_req.data.Resources[0].allowedSystems.length === 0) {
        //         users_req.data.Resources[0].active = "False"
        //     } else {
        //         users_req.data.Resources[0].active = "True"
        //     };
        // };

        scimifiedResponse = users_req;
    
    };

    //Create user
    if (req.method === "POST") {
        context.log('Is create user request');
        context.log(req.body)
        var accessRoleId = access_roles.Resources.filter(item => item.name === req.body.accessRoleDisplayName).map(item => item.id);
        req.body['accessRole'] = accessRoleId[0];
        context.log(accessRoleId)
        context.log(accessRoleId[0])
        //So there should be no need to set a password because the WalkMe spec doesn't require it, but apparently it does.
        //While the password should not really matter as the account will be authenticated via SAML, just making it pseudo-random to be safe.
        const Crypto = require('crypto');
        req.body['password'] = "Scim@2021!" + Crypto
            .randomBytes(21)
            .toString('hex')
            .slice(0, 21);
        context.log(req.body);
        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        var users_req = await axios.post('https://api.walkme.com/public/v1/scim/Users', req.body, options1).then(function(response) {
            //context.log(JSON.stringify(response.data))
            return response;
            }).catch(function(error) {
                return error.response;
        });
        
        scimifiedResponse = users_req;
    };

    //Update user
    if (req.method === "PATCH") {
        context.log('Is update user request');

        //we first need to get the user's external ID, because this is not optional (against spec)
        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        var userExternalId = await axios.get('https://api.walkme.com/public/v1/scim/Users/' + req.params.user_id, options1).then(function(response) {
            return response.data.externalId;
            }).catch(function(error) {
                //return null if not found so we can give the proper response of the PUT request
                //return error.response.data;
            });
        const putreq = {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            externalId: userExternalId,
            name: {}
        };
        context.log(req.body.Operations)
        for (const i in req.body.Operations) {
            if (req.body.Operations[i].path === 'name.givenName') {putreq.name.givenName = req.body.Operations[i].value};
            if (req.body.Operations[i].path === 'name.familyName') {putreq.name.familyName = req.body.Operations[i].value};
            if (req.body.Operations[i].path === 'externalId') {putreq.externalId = req.body.Operations[i].value};
            if (req.body.Operations[i].path === 'userName') {putreq.userName = req.body.Operations[i].value};
            if (req.body.Operations[i].path === 'accessRoleDisplayName') {
                var accessRoleId = access_roles.Resources.filter(item => item.name === req.body.Operations[i].value).map(item => item.id);
                putreq.accessRole = accessRoleId[0];
            };
            //TODO: accept an active status change and convert it to a pseudo-active status based on assigned systems
            // if (req.body.Operations[i].path === 'active' && req.body.Operations[i].value === 'False') {
            //     //AAD marks for soft deletion then performs a DELETE request 30 days later. As there is no active marker, removing all systems and marking the name for deletion.
            //     putreq.name.givenName = "AAD MARKED FOR DELETION";
            //     putreq.name.familyName = "AAD MARKED FOR DELETION";
            //     putreq.allowedSystems = [""];
            // };

          }
        var users_req = await axios.put('https://api.walkme.com/public/v1/scim/Users/' + req.params.user_id, putreq, options1).then(function(response) {
            // if (response.data.allowedSystems.length === 0) {response.data.active = "False"} else {response.data.active = "True"};
            return response;
            }).catch(function(error) {
                return error.response;
        });
        
        scimifiedResponse = users_req;
    };

    //Delete user
    if (req.method === "DELETE") {
        context.log('Is delete user request');
        context.log(req);
        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        var users_req = await axios.delete('https://api.walkme.com/public/v1/scim/Users/' + req.params.user_id, options1).then(function(response) {
            //context.log(JSON.stringify(response.data))
            context.log(response.data);
            return response;
            }).catch(function(error) {
                return error.response;
        });
        
        scimifiedResponse = users_req;
    };
    ////
    context.log(scimifiedResponse);
    context.res = {
        // status: 200, /* Defaults to 200 */
        status: scimifiedResponse.status,
        body: scimifiedResponse.data
    };

}