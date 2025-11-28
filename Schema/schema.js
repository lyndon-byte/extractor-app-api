const dynamicSchema = {

    "name": "schema_field_list",
    "strict": true,
    "schema": {
      "type": "object",
      "properties": {
        "schema_name": {
          "type": "string",
          "description": "name or title of the data",
        },
        "fields": {
          "type": "array",
          "description": "A list of field definitions describing the desired data structure.",
          "items": {
            "$ref": "#/$defs/schema_field"
          }
        }
      },
      "required": [
        "schema_name",
        "fields"
      ],
      "additionalProperties": false,
      "$defs": {
        "schema_field": {
          "type": "object",
          "properties": {
            "key": {
              "type": "string",
              "description": "The key identifying this field."
            },
            "type": {
              "type": "string",
              "description": "The data type of the field.",
              "enum": [
                "string",
                "array",
                "object"
              ]
            },
            "description": {
              "type": "string",
              "description": "A human-readable description of the field."
            },
            "items": {
              "anyOf": [
                {
                  "$ref": "#/$defs/schema_field"
                },
                {
                  "type": "object",
                  "properties": {
                    "type": {
                      "type": "string",
                      "enum": [
                        "string",
                        "array",
                        "object"
                      ]
                    }
                  },
                  "required": [
                    "type"
                  ],
                  "additionalProperties": false
                }
              ],
              "description": "If the type is 'array', defines the schema of the items."
            },
            "properties": {
              "type": "array",
              "description": "If the type is 'object', a list of sub-field definitions.",
              "items": {
                "$ref": "#/$defs/schema_field"
              }
            }
          },
          "required": [
            "key",
            "type",
            "description",
            "items",
            "properties"
          ],
          "additionalProperties": false
        }
      }
    }
  }

  export default dynamicSchema;