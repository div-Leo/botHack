
'use strict';
require('es6-promise').polyfill();
require('isomorphic-fetch');

const
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),
  request = require('request'),
  generateLink = require('./data.js'),
  arrOfQuest = require('./questObj.js');

var idQuest = 0;

var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));


const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ?
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}


app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
});

app.post('/webhook', function (req, res) {
  var data = req.body;

  if (data.object == 'page') {
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else if (messagingEvent.read) {
          receivedMessageRead(messagingEvent);
        } else if (messagingEvent.account_linking) {
          receivedAccountLink(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    res.sendStatus(200);
  }
});


app.get('/authorize', function(req, res) {
  var accountLinkingToken = req.query.account_linking_token;
  var redirectURI = req.query.redirect_uri;

  var authCode = "1234567890";

  var redirectURISuccess = redirectURI + "&authorization_code=" + authCode;

  res.render('authorize', {
    accountLinkingToken: accountLinkingToken,
    redirectURI: redirectURI,
    redirectURISuccess: redirectURISuccess
  });
});


function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {

    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

function receivedAuthentication(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfAuth = event.timestamp;

  var passThroughParam = event.optin.ref;

  console.log("Received authentication for user %d and page %d with pass " +
    "through param '%s' at %d", senderID, recipientID, passThroughParam,
    timeOfAuth);

  sendTextMessage(senderID, "Authentication successful");
}

function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:",
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s",
      messageId, appId, metadata);
    return;
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
      if (quickReplyPayload.match(/false/)) {
        console.log(quickReplyPayload, '<-------------- if false faccio cose');
        var topic = quickReplyPayload.split(' ').slice(1).join(' ');
        quickReplyPayload = quickReplyPayload.split(' ')[0]
      }
      switch (quickReplyPayload.replace(/[^\w\s]/gi, '').trim().toLowerCase()) {
        case 'javascript quiz':
              // sendTextMessage(senderID, 'Grate! let\'s start!');
              idQuest = 0;
              quest(senderID, idQuest);
          break;

        case 'true':
              // sendTextMessage(senderID, 'Grate! next question!');
              idQuest++;
              quest(senderID, idQuest);
          break;

        case 'false':
              idQuest = 0;
              // sendTextMessage(senderID, 'Oh Noo! 😱  This is not the right answare.\n Let\'s review toghether this topic');
              wrongQuest(senderID, topic);
          break;

        case 'javascript':
          sendDifficulty(senderID);
          break;

        case 'easy':
        case 'mid':
        case 'hard':
          var diff = quickReplyPayload;
          var linky = generateLink(diff);
          sendChallangeLink(senderID, linky);
          break;

      }
    return;
  }

  if (messageText) {
    switch (messageText.replace(/[^\w\s]/gi, '').trim().toLowerCase()) {
      case 'hello':
      case 'hi':
        sendHiMessage(senderID);
        break;

      case 'test':
        startTest(senderID);
        break;

      case 'gif':
        sendGifMessage(sendGifMessage, [senderID]);
        break;

      case 'button':
        sendButtonMessage(senderID);
        break;

      case 'typing on':
        sendTypingOn(senderID);
        break;

      case 'typing off':
        sendTypingOff(senderID);
        break;

      case 'account linking':
        requiresServerURL(sendAccountLinking, [senderID]);
        break;

      case 'help':
        sendHelpMenu(senderID);
        break;

      case 'train':
        sendLanguage(senderID);
        break;

      case 'exit':
        sendTextMessage(senderID, 'Ok, see you whenever you want to be tested again 👋 ');
        break;

      case 'thanks':
        sendTextMessage(senderID, 'My palsure to help you');
        break;

      default:
        var rdmResp = ['I didn\'t get you', 'I\'m not sure but.. i have no idea', 'What sorry?', 'Yeah I totaly agree with you halfway', 'I\'m bilding a card castle, don\'t bother me', 'You can tell taht, but I can.. as I can just type', 'I can\'t answare to you but can we still be friend :D'];
        messageText = rdmResp[Math.floor(Math.random()*rdmResp.length)];
        sendTextMessage(senderID, messageText);
    }
  } else if (messageAttachments) {
    sendTextMessage(senderID, "Message with attachment received");
  }
}


function receivedDeliveryConfirmation(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var delivery = event.delivery;
  var messageIDs = delivery.mids;
  var watermark = delivery.watermark;
  var sequenceNumber = delivery.seq;

  if (messageIDs) {
    messageIDs.forEach(function(messageID) {
      console.log("Received delivery confirmation for message ID: %s",
        messageID);
    });
  }

  console.log("All message before %d were delivered.", watermark);
}

function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " +
    "at %d", senderID, recipientID, payload, timeOfPostback);

  sendTextMessage(senderID, "Postback called");
}

function receivedMessageRead(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  var watermark = event.read.watermark;
  var sequenceNumber = event.read.seq;

  console.log("Received message read event for watermark %d and sequence " +
    "number %d", watermark, sequenceNumber);
}

function receivedAccountLink(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  var status = event.account_linking.status;
  var authCode = event.account_linking.authorization_code;

  console.log("Received account link event with for user %d with status %s " +
    "and auth code %s ", senderID, status, authCode);
}


function sendHiMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: `
Hi! i'm here to make you the best developer of the world.

We can "train" toghether or I can "test" your knowledge, or just send funny "gif".

Btw, if you need any "help" just ask.

Have fun! 🤙
      `
    }
  }

  callSendAPI(messageData);
}

function sendHelpMenu(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: `
I'm in a developing stage! Lets learn together! Commands I already understand:

test - I'm gonna test your knowledge about coding 🤓

train - Generates random code challange 💪

exit - If you want to drop the running activity 🔙

gif - I'll send you a random gif about programming 😂
      `
    }
  }
  callSendAPI(messageData);
}


function sendGifMessage(recipientId) {
  let gifJSON
  let url = 'http://api.giphy.com/v1/gifs/random?api_key=zvn353Fk25gQ9V6vE0UGVcN4DIyOXk4z&tag=programming';
  fetch(url, { method: 'GET' })
    .then(function(response) {
    response.text().then(function(text) {
        gifJSON = JSON.parse(text);
        var messageData = {
          recipient: {
            id: recipientId
          },
          message: {
            attachment: {
              type: "image",
              payload: {
                url: gifJSON.data.image_original_url
              }
            }
          }
        };
        callSendAPI(messageData);
    });
  })
}


function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}


function sendButtonMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "This is test text",
          buttons:[{
            type: "web_url",
            url: "https://www.oculus.com/en-us/rift/",
            title: "Open Web URL"
          }, {
            type: "postback",
            title: "Trigger Postback",
            payload: "DEVELOPER_DEFINED_PAYLOAD"
          }, {
            type: "phone_number",
            title: "Call Phone Number",
            payload: "+16505551234"
          }]
        }
      }
    }
  };
  callSendAPI(messageData);
}


// function wrongQuest(recipientId, topic) {
//   var messageData = {
//     recipient: {
//       id: recipientId
//     },
//     message: {
//       attachment: {
//         type: "template",
//         payload: {
//           template_type: "generic",
//           elements: {
//             title: topic.split('/').slice(-1)[0],
//             subtitle: `Take a look at this topic, is better to revise`,
//             item_url: `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/${topic}`,
//             image_url: "../image/mdn.png",
//             buttons: [{
//               type: "web_url",
//               url: `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/${topic}`,
//               title: "Open MDN"
//             }, {
//               type: "postback",
//               title: "Start again",
//               text: "test"
//             }],
//           }
//         }
//       }
//     }
//   };
//   callSendAPI(messageData);
// }

function wrongQuest(recipientId, topic) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: `Take a look at ${topic.split('/').slice(-1)[0]}, is better to revise`,
          buttons:[{
            type: "web_url",
            url: `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/${topic}`,
            title: "Open MDN"
          }]
        }
      }
    }
  };
  callSendAPI(messageData);
}

function sendChallangeLink(recipientId, linky) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: `Open the link I've just sent you, a new challenge is wating for you`,
          buttons:[{
            type: "web_url",
            url: `${linky}`,
            title: "Open Codewars"
          }]
        }
      }
    }
  };
  callSendAPI(messageData);
}

function sendDifficulty(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "Feeling lucky today? Select your level",
      quick_replies: [
        {
          "content_type":"text",
          "title":"Easy",
          "payload":"easy"
        },
        {
          "content_type":"text",
          "title":"Medium",
          "payload":"mid"
        },
        {
          "content_type":"text",
          "title":"Hard",
          "payload":"hard"
        }
      ]
    }
  };
  callSendAPI(messageData);
}


function sendLanguage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "Please choose a language, you would like to train today",
      quick_replies: [
        {
          "content_type":"text",
          "title":"Javascript",
          "payload":"Javascript",
          "image_url":"http://ecodile.com/wp-content/uploads/2015/10/node_icon2.png"
        }
      ]
    }
  };
  callSendAPI(messageData);
}



function startTest(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: `
Amazing I'm gonna challenge your knowledge!
Choose the languange`,
      quick_replies: [
        {
          "content_type":"text",
          "title":"Javascript",
          "payload": "javascript quiz"
        }
      ]
    }
  };
  callSendAPI(messageData);
}

function quest(recipientId, id = 0) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: arrOfQuest[id].quest,
      quick_replies: [
        {
          "content_type":"text",
          "title":arrOfQuest[id].title[0],
          "payload": arrOfQuest[id].payload[0]
        },
        {
          "content_type":"text",
          "title":arrOfQuest[id].title[1],
          "payload": arrOfQuest[id].payload[1]
        },
        {
          "content_type":"text",
          "title":arrOfQuest[id].title[2],
          "payload": arrOfQuest[id].payload[2]
        }
      ]
    }
  };
callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {
  console.log("Sending a read receipt to mark message as seen");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "mark_seen"
  };

  callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {
  console.log("Turning typing indicator on");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_on"
  };

  callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {
  console.log("Turning typing indicator off");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_off"
  };

  callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Welcome. Link your account.",
          buttons:[{
            type: "account_link",
            url: SERVER_URL + "/authorize"
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s",
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s",
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;