import { RuleValidator, ValidationError } from './deps.ts';
import { QRSchemaElement, rootScheme } from './element-scheme.ts';
import { QRCodeNode } from './qrcode-node.ts';
import { computeCRC } from './crc.ts';

export enum QRErrorCode {
  INVALID_PARAM,
  INVALID_QRCODE,
  CRC_MISMATCH,
  MISSING_MANDATORY_ELEMENT,
  INVALID_ELEMENT,
}

export class QRCodeError extends ValidationError<QRErrorCode> {
  constructor( public errorCode: QRErrorCode, message?: string ) {
    super( errorCode, message );

    this.errorName = "EMVQR-" + QRErrorCode[ errorCode ];
  }
}

const mandatoryElements: number[] = [
  0,    // Start
  52,
  53,
  58,
  59,
  60,
  63    // CRC
];

function validateElement( val: string|undefined, schema: QRSchemaElement, path: string ) {
  //console.log( "Validating: " + path + `[${val}]` )

  // optional?
  if ( val == undefined ) {
    if ( !schema.optional ) {
      throw new QRCodeError( QRErrorCode.MISSING_MANDATORY_ELEMENT, `Element ${path} missing and is mandatory` );
    }

    return;
  }

  // length
  if ( schema.length != undefined ) {
    if ( schema.length instanceof Object ) {
      let lenInfo = schema.length;

      if ( lenInfo.max && ( val.length > lenInfo.max ) )
        throw new QRCodeError( QRErrorCode.INVALID_ELEMENT, `Element ${path} must have maximum length of ${lenInfo.max}` );
      if ( lenInfo.min && ( val.length < lenInfo.min ) )
        throw new QRCodeError( QRErrorCode.INVALID_ELEMENT, `Element ${path} must have minimum length of ${lenInfo.min}` );
    } else {
      if ( val.length != schema.length )
        throw new QRCodeError( QRErrorCode.INVALID_ELEMENT, `Element ${path} must have length of ${schema.length}` );
    }
  }

  // pattern regex
  if ( schema.pattern != undefined ) {
    let pattern = ( schema.pattern instanceof RegExp ) ? schema.pattern : new RegExp( schema.pattern );

    //console.log( `pattern /${pattern.source}/ (${val}) => ${pattern.test(val)}`)
    if ( !pattern.test( val ) )
      throw new QRCodeError( QRErrorCode.INVALID_ELEMENT, `Element ${path} has invalid contents` );
  }
}

function validateNode( node: QRCodeNode, schema: QRSchemaElement, path: string = "") {
  //console.log( "Validating: " + path + `=[${node.content}]:${node.type}` )

  if ( node.isType( 'data' ) ) {
    validateElement( node.content, schema, path );
  }
  else {
    node.elements.forEach( (element: QRCodeNode ) => {
      let nodeScheme: QRSchemaElement = schema?.elementMap?.[ element.tag! ] ?? { name: 'unknown', elementMap: {} };

      let elementPath = path + (path.length ? ":" : "") + ("00"+element.tag!).slice( -2 );

      validateNode( element, nodeScheme, elementPath );
    })
  }
}

export function getRuleValidator(): RuleValidator<QRCodeNode> {
  return RuleValidator.get<QRCodeNode>( { id: "EMVQR" } )
    .addRule( {
        id: "start-element-00",
        description: "Initial element is '00' with contents '01'",
        rule: ( root, _val ) => {

          if ( root.getElement( 0 ).baseOffset != 0 ) {
            throw new QRCodeError( QRErrorCode.INVALID_QRCODE, "Missing start element (00)" );
          };

          if ( root.getElement( 0 ).content != '01' ) {
            throw new QRCodeError( QRErrorCode.INVALID_QRCODE, "Invalid value for start element (00)" );
          };
        }
      }
    )
    .addRule( {
        id: "final-element-63",
        description: "Final element is CRC '63'",
        rule: ( root, _val ) => {
          let crcEl = root.getElement( 63 );

          if ( ( crcEl.baseOffset != root.content.length - 8 ) || ( root.content.slice(-8,-4) != '6304') ) {
            throw new QRCodeError( QRErrorCode.INVALID_QRCODE, "CRC must be final element (63)" );
          }
        }
      },
    )
    .addRule( {
        id: "valid-crc",
        description: "CRC is valid",
        rule: ( root, _val ) => {
          let crcEl = root.getElement( 63 );

          // 3. CRC Correct
          let calculatedCRC = computeCRC( root.content.slice( 0, -4 ) );
          if ( calculatedCRC != crcEl.content ) {
            throw new QRCodeError( QRErrorCode.CRC_MISMATCH, "Invalid CRC" );
          }
        }
      }
    )
    .addRule( {
        id: "one-or-more-mai",
        description: "Contains one or more Merchant Account Information elements",
        rule: ( root, _val ) => {
          let maiList = Array.from( root.elements.keys() ).filter( (v) => ( v >=2 ) && ( v <= 51 ) );

          if ( maiList.length == 0 ) {
            throw new QRCodeError( QRErrorCode.MISSING_MANDATORY_ELEMENT, "Must have at least one Merchant Account Information" );
          }
        }
      }
    )
    .addRule( {
        id: "mandatory-elements",
        description: "Contains EMV mandatory elements",
        rule: ( root, _val ) => {
          mandatoryElements.forEach( (tag) => {
            if ( !root.hasElement( tag as number ) )
              throw new QRCodeError( QRErrorCode.MISSING_MANDATORY_ELEMENT, "Missing mandatory tag (" + tag + ")" );
          })
        }
      }
    )
    .addRule( {
        id: "valid-elements",
        description: "Elements are valid",
        rule: ( root, _val ) => {
          validateNode( root, rootScheme );
        }
      }
    );
}
