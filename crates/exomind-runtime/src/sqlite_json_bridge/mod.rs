#![allow(dead_code)]

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
#[cfg(test)]
use serde_json::json;
use serde_json::{Map, Number, Value};
use thiserror::Error;

pub type JsonKey = Map<String, Value>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SqlType {
    Text,
    Integer,
    Real,
    Boolean,
}

impl SqlType {
    fn as_sql(&self) -> &'static str {
        match self {
            SqlType::Text => "TEXT",
            SqlType::Integer => "INTEGER",
            SqlType::Real => "REAL",
            SqlType::Boolean => "INTEGER",
        }
    }
}

#[derive(Debug, Clone)]
pub struct FieldDef {
    pub json_key: String,
    pub column_name: String,
    pub sql_type: SqlType,
    pub nullable: bool,
    pub default_json: Option<Value>,
}

impl FieldDef {
    pub fn text(name: &str) -> Self {
        Self::new(name, SqlType::Text)
    }

    pub fn integer(name: &str) -> Self {
        Self::new(name, SqlType::Integer)
    }

    pub fn real(name: &str) -> Self {
        Self::new(name, SqlType::Real)
    }

    pub fn boolean(name: &str) -> Self {
        Self::new(name, SqlType::Boolean)
    }

    pub fn new(name: &str, sql_type: SqlType) -> Self {
        Self {
            json_key: name.to_string(),
            column_name: name.to_string(),
            sql_type,
            nullable: false,
            default_json: None,
        }
    }

    pub fn column_name(mut self, column_name: &str) -> Self {
        self.column_name = column_name.to_string();
        self
    }

    pub fn nullable(mut self) -> Self {
        self.nullable = true;
        self
    }

    pub fn default_json(mut self, value: Value) -> Self {
        self.default_json = Some(value);
        self
    }

    fn sql_definition(&self) -> Result<String, BridgeError> {
        validate_identifier(&self.column_name)?;
        let mut definition = format!("{} {}", self.column_name, self.sql_type.as_sql());
        if !self.nullable {
            definition.push_str(" NOT NULL");
        }
        if let Some(default_json) = &self.default_json {
            definition.push_str(" DEFAULT ");
            definition.push_str(&sql_literal_for_default(default_json, self.sql_type)?);
        }
        Ok(definition)
    }

    fn value_or_default(&self, doc: &Map<String, Value>) -> Result<Value, BridgeError> {
        if let Some(value) = doc.get(&self.json_key) {
            return Ok(value.clone());
        }
        if let Some(default_json) = &self.default_json {
            return Ok(default_json.clone());
        }
        if self.nullable {
            return Ok(Value::Null);
        }
        Err(BridgeError::MissingRequiredField {
            field: self.json_key.clone(),
        })
    }

    fn to_sql_value(&self, value: &Value) -> Result<SqlValue, BridgeError> {
        json_value_to_sql_typed(&self.json_key, value, self.sql_type, self.nullable)
    }

    fn from_row(&self, row: &rusqlite::Row<'_>, index: usize) -> Result<Value, BridgeError> {
        match self.sql_type {
            SqlType::Text => {
                let value = row.get::<_, Option<String>>(index)?;
                Ok(value.map(Value::String).unwrap_or(Value::Null))
            }
            SqlType::Integer => {
                let value = row.get::<_, Option<i64>>(index)?;
                Ok(value
                    .map(|number| Value::Number(Number::from(number)))
                    .unwrap_or(Value::Null))
            }
            SqlType::Real => {
                let value = row.get::<_, Option<f64>>(index)?;
                Ok(match value {
                    Some(number) => Value::Number(Number::from_f64(number).ok_or_else(|| {
                        BridgeError::InvalidRealValue {
                            field: self.json_key.clone(),
                            value: number,
                        }
                    })?),
                    None => Value::Null,
                })
            }
            SqlType::Boolean => {
                let value = row.get::<_, Option<i64>>(index)?;
                Ok(match value {
                    Some(0) => Value::Bool(false),
                    Some(1) => Value::Bool(true),
                    Some(other) => {
                        return Err(BridgeError::FieldTypeMismatch {
                            field: self.json_key.clone(),
                            expected: "boolean".to_string(),
                            actual: format!("integer({other})"),
                        });
                    }
                    None => Value::Null,
                })
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct PreservedFieldDef {
    pub json_key: String,
    pub column_name: String,
    pub nullable: bool,
    pub default_json: Option<Value>,
}

impl PreservedFieldDef {
    pub fn json(name: &str) -> Self {
        Self {
            json_key: name.to_string(),
            column_name: format!("{name}_json"),
            nullable: false,
            default_json: None,
        }
    }

    pub fn column_name(mut self, column_name: &str) -> Self {
        self.column_name = column_name.to_string();
        self
    }

    pub fn nullable(mut self) -> Self {
        self.nullable = true;
        self
    }

    pub fn default_json(mut self, value: Value) -> Self {
        self.default_json = Some(value);
        self
    }

    fn sql_definition(&self) -> Result<String, BridgeError> {
        validate_identifier(&self.column_name)?;
        let mut definition = format!("{} TEXT", self.column_name);
        if !self.nullable {
            definition.push_str(" NOT NULL");
        }
        if let Some(default_json) = &self.default_json {
            definition.push_str(" DEFAULT ");
            definition.push_str(&sql_literal_for_json(default_json)?);
        }
        Ok(definition)
    }

    fn value_or_default(&self, doc: &Map<String, Value>) -> Result<Value, BridgeError> {
        if let Some(value) = doc.get(&self.json_key) {
            return Ok(value.clone());
        }
        if let Some(default_json) = &self.default_json {
            return Ok(default_json.clone());
        }
        if self.nullable {
            return Ok(Value::Null);
        }
        Err(BridgeError::MissingRequiredField {
            field: self.json_key.clone(),
        })
    }

    fn to_sql_value(&self, value: &Value) -> Result<SqlValue, BridgeError> {
        if value.is_null() {
            if self.nullable {
                return Ok(SqlValue::Null);
            }
            return Err(BridgeError::FieldTypeMismatch {
                field: self.json_key.clone(),
                expected: "non-null json".to_string(),
                actual: "null".to_string(),
            });
        }

        Ok(SqlValue::Text(serde_json::to_string(value)?))
    }

    fn from_row(&self, row: &rusqlite::Row<'_>, index: usize) -> Result<Value, BridgeError> {
        let value = row.get::<_, Option<String>>(index)?;
        match value {
            Some(json_text) => Ok(serde_json::from_str(&json_text)?),
            None => Ok(Value::Null),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ExtFieldDef {
    pub column_name: String,
    pub nullable: bool,
    pub default_json: Option<Value>,
}

impl ExtFieldDef {
    pub fn new(column_name: &str) -> Self {
        Self {
            column_name: column_name.to_string(),
            nullable: false,
            default_json: None,
        }
    }

    pub fn nullable(mut self) -> Self {
        self.nullable = true;
        self
    }

    pub fn default_json(mut self, value: Value) -> Self {
        self.default_json = Some(value);
        self
    }

    fn sql_definition(&self) -> Result<String, BridgeError> {
        validate_identifier(&self.column_name)?;
        let mut definition = format!("{} TEXT", self.column_name);
        if !self.nullable {
            definition.push_str(" NOT NULL");
        }
        if let Some(default_json) = &self.default_json {
            definition.push_str(" DEFAULT ");
            definition.push_str(&sql_literal_for_json(default_json)?);
        }
        Ok(definition)
    }

    fn to_sql_value(&self, value: &Map<String, Value>) -> Result<SqlValue, BridgeError> {
        Ok(SqlValue::Text(serde_json::to_string(value)?))
    }

    fn from_row(
        &self,
        row: &rusqlite::Row<'_>,
        index: usize,
    ) -> Result<Map<String, Value>, BridgeError> {
        let value = row.get::<_, Option<String>>(index)?;
        match value {
            Some(json_text) => {
                let parsed = serde_json::from_str::<Value>(&json_text)?;
                match parsed {
                    Value::Object(map) => Ok(map),
                    other => Err(BridgeError::ExtFieldMustBeObject {
                        column: self.column_name.clone(),
                        actual: json_type_name(&other).to_string(),
                    }),
                }
            }
            None => Ok(Map::new()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct IndexDef {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
}

impl IndexDef {
    pub fn new(name: &str, columns: &[&str]) -> Self {
        Self {
            name: name.to_string(),
            columns: columns.iter().map(|column| (*column).to_string()).collect(),
            unique: false,
        }
    }

    pub fn unique(mut self) -> Self {
        self.unique = true;
        self
    }
}

#[derive(Debug, Clone)]
pub struct TableSchema {
    pub table_name: String,
    pub primary_keys: Vec<String>,
    pub expanded_fields: Vec<FieldDef>,
    pub preserved_fields: Vec<PreservedFieldDef>,
    pub ext_field: Option<ExtFieldDef>,
    pub indexes: Vec<IndexDef>,
}

impl TableSchema {
    pub fn new(table_name: &str) -> Self {
        Self {
            table_name: table_name.to_string(),
            primary_keys: Vec::new(),
            expanded_fields: Vec::new(),
            preserved_fields: Vec::new(),
            ext_field: None,
            indexes: Vec::new(),
        }
    }

    pub fn primary_keys(mut self, primary_keys: &[&str]) -> Self {
        self.primary_keys = primary_keys.iter().map(|key| (*key).to_string()).collect();
        self
    }

    pub fn expanded_fields(mut self, expanded_fields: Vec<FieldDef>) -> Self {
        self.expanded_fields = expanded_fields;
        self
    }

    pub fn preserved_fields(mut self, preserved_fields: Vec<PreservedFieldDef>) -> Self {
        self.preserved_fields = preserved_fields;
        self
    }

    pub fn ext_field(mut self, ext_field: ExtFieldDef) -> Self {
        self.ext_field = Some(ext_field);
        self
    }

    pub fn indexes(mut self, indexes: Vec<IndexDef>) -> Self {
        self.indexes = indexes;
        self
    }

    fn validate(&self) -> Result<(), BridgeError> {
        validate_identifier(&self.table_name)?;
        if self.primary_keys.is_empty() {
            return Err(BridgeError::SchemaInvalid {
                table: self.table_name.clone(),
                reason: "schema must declare at least one primary key".to_string(),
            });
        }
        let ext_field = self
            .ext_field
            .as_ref()
            .ok_or_else(|| BridgeError::SchemaInvalid {
                table: self.table_name.clone(),
                reason: "schema must declare ext_field".to_string(),
            })?;

        let mut json_keys = HashSet::new();
        let mut column_names = HashSet::new();
        for field in &self.expanded_fields {
            validate_identifier(&field.column_name)?;
            if !json_keys.insert(field.json_key.clone()) {
                return Err(BridgeError::SchemaInvalid {
                    table: self.table_name.clone(),
                    reason: format!("duplicate expanded field `{}`", field.json_key),
                });
            }
            if !column_names.insert(field.column_name.clone()) {
                return Err(BridgeError::SchemaInvalid {
                    table: self.table_name.clone(),
                    reason: format!("duplicate column `{}`", field.column_name),
                });
            }
        }

        for field in &self.preserved_fields {
            validate_identifier(&field.column_name)?;
            if !json_keys.insert(field.json_key.clone()) {
                return Err(BridgeError::SchemaInvalid {
                    table: self.table_name.clone(),
                    reason: format!("duplicate field `{}`", field.json_key),
                });
            }
            if !column_names.insert(field.column_name.clone()) {
                return Err(BridgeError::SchemaInvalid {
                    table: self.table_name.clone(),
                    reason: format!("duplicate column `{}`", field.column_name),
                });
            }
        }

        validate_identifier(&ext_field.column_name)?;
        if !column_names.insert(ext_field.column_name.clone()) {
            return Err(BridgeError::SchemaInvalid {
                table: self.table_name.clone(),
                reason: format!("duplicate column `{}`", ext_field.column_name),
            });
        }

        for primary_key in &self.primary_keys {
            if self.expanded_field(primary_key).is_none() {
                return Err(BridgeError::SchemaInvalid {
                    table: self.table_name.clone(),
                    reason: format!(
                        "primary key `{primary_key}` must also exist in expanded_fields"
                    ),
                });
            }
        }

        for index in &self.indexes {
            validate_identifier(&index.name)?;
            if index.columns.is_empty() {
                return Err(BridgeError::SchemaInvalid {
                    table: self.table_name.clone(),
                    reason: format!("index `{}` must declare columns", index.name),
                });
            }
            for column in &index.columns {
                validate_identifier(column)?;
                if !self.has_column(column) {
                    return Err(BridgeError::SchemaInvalid {
                        table: self.table_name.clone(),
                        reason: format!(
                            "index `{}` references unknown column `{column}`",
                            index.name
                        ),
                    });
                }
            }
        }

        Ok(())
    }

    fn expanded_field(&self, json_key: &str) -> Option<&FieldDef> {
        self.expanded_fields
            .iter()
            .find(|field| field.json_key == json_key)
    }

    fn has_column(&self, column_name: &str) -> bool {
        self.expanded_fields
            .iter()
            .any(|field| field.column_name == column_name)
            || self
                .preserved_fields
                .iter()
                .any(|field| field.column_name == column_name)
            || self
                .ext_field
                .as_ref()
                .map(|field| field.column_name == column_name)
                .unwrap_or(false)
    }

    fn all_column_names(&self) -> Vec<String> {
        let mut columns = self
            .expanded_fields
            .iter()
            .map(|field| field.column_name.clone())
            .collect::<Vec<_>>();
        columns.extend(
            self.preserved_fields
                .iter()
                .map(|field| field.column_name.clone()),
        );
        if let Some(ext_field) = &self.ext_field {
            columns.push(ext_field.column_name.clone());
        }
        columns
    }

    fn known_json_keys(&self) -> HashSet<String> {
        let mut keys = self
            .expanded_fields
            .iter()
            .map(|field| field.json_key.clone())
            .collect::<HashSet<_>>();
        keys.extend(
            self.preserved_fields
                .iter()
                .map(|field| field.json_key.clone()),
        );
        keys
    }

    fn create_table_sql(&self) -> Result<String, BridgeError> {
        let mut parts = Vec::new();
        for field in &self.expanded_fields {
            parts.push(field.sql_definition()?);
        }
        for field in &self.preserved_fields {
            parts.push(field.sql_definition()?);
        }
        if let Some(ext_field) = &self.ext_field {
            parts.push(ext_field.sql_definition()?);
        }

        let pk_columns = self
            .primary_keys
            .iter()
            .map(|json_key| {
                self.expanded_field(json_key)
                    .map(|field| field.column_name.clone())
                    .ok_or_else(|| BridgeError::SchemaInvalid {
                        table: self.table_name.clone(),
                        reason: format!(
                            "primary key `{json_key}` missing expanded field definition"
                        ),
                    })
            })
            .collect::<Result<Vec<_>, _>>()?;
        parts.push(format!("PRIMARY KEY ({})", pk_columns.join(", ")));

        Ok(format!(
            "CREATE TABLE IF NOT EXISTS {} ({})",
            self.table_name,
            parts.join(", ")
        ))
    }

    fn row_to_json(&self, row: &rusqlite::Row<'_>) -> Result<Value, BridgeError> {
        let mut doc = Map::new();
        let mut index = 0usize;
        for field in &self.expanded_fields {
            doc.insert(field.json_key.clone(), field.from_row(row, index)?);
            index += 1;
        }
        for field in &self.preserved_fields {
            doc.insert(field.json_key.clone(), field.from_row(row, index)?);
            index += 1;
        }
        if let Some(ext_field) = &self.ext_field {
            let ext = ext_field.from_row(row, index)?;
            for (key, value) in ext {
                doc.entry(key).or_insert(value);
            }
        }
        Ok(Value::Object(doc))
    }

    fn extract_key_from_doc(&self, doc: &Map<String, Value>) -> Result<JsonKey, BridgeError> {
        let mut key = Map::new();
        for json_key in &self.primary_keys {
            let field =
                self.expanded_field(json_key)
                    .ok_or_else(|| BridgeError::SchemaInvalid {
                        table: self.table_name.clone(),
                        reason: format!("unknown primary key field `{json_key}`"),
                    })?;
            key.insert(json_key.clone(), field.value_or_default(doc)?);
        }
        Ok(key)
    }
}

#[derive(Debug, Clone, Default)]
pub struct SchemaRegistry {
    tables: HashMap<String, TableSchema>,
}

impl SchemaRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, schema: TableSchema) -> Result<(), BridgeError> {
        schema.validate()?;
        if self.tables.contains_key(&schema.table_name) {
            return Err(BridgeError::SchemaInvalid {
                table: schema.table_name.clone(),
                reason: "duplicate table registration".to_string(),
            });
        }
        self.tables.insert(schema.table_name.clone(), schema);
        Ok(())
    }

    fn table(&self, table_name: &str) -> Result<&TableSchema, BridgeError> {
        self.tables
            .get(table_name)
            .ok_or_else(|| BridgeError::UnknownTable {
                table: table_name.to_string(),
            })
    }

    fn iter(&self) -> impl Iterator<Item = &TableSchema> {
        self.tables.values()
    }
}

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("unknown table: {table}")]
    UnknownTable { table: String },
    #[error("schema invalid for table `{table}`: {reason}")]
    SchemaInvalid { table: String, reason: String },
    #[error("document must be a JSON object")]
    DocumentMustBeObject,
    #[error("missing required field: {field}")]
    MissingRequiredField { field: String },
    #[error("field `{field}` type mismatch: expected {expected}, got {actual}")]
    FieldTypeMismatch {
        field: String,
        expected: String,
        actual: String,
    },
    #[error("numeric overflow for field `{field}`")]
    NumericOverflow { field: String },
    #[error("invalid real value for field `{field}`: {value}")]
    InvalidRealValue { field: String, value: f64 },
    #[error("key missing primary key field `{field}`")]
    MissingPrimaryKeyField { field: String },
    #[error("unsupported migration for table `{table}`: {reason}")]
    UnsupportedMigration { table: String, reason: String },
    #[error("invalid SQL identifier: {identifier}")]
    InvalidIdentifier { identifier: String },
    #[error("ext field `{column}` must be a JSON object, got {actual}")]
    ExtFieldMustBeObject { column: String, actual: String },
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug)]
pub struct SqliteJsonBridge {
    path: Option<PathBuf>,
    connection: Mutex<Connection>,
    registry: SchemaRegistry,
}

impl SqliteJsonBridge {
    pub fn open(path: &Path, registry: SchemaRegistry) -> Result<Self, BridgeError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(path)?;
        let bridge = Self {
            path: Some(path.to_path_buf()),
            connection: Mutex::new(connection),
            registry,
        };
        bridge.init()?;
        Ok(bridge)
    }

    pub fn open_in_memory(registry: SchemaRegistry) -> Result<Self, BridgeError> {
        let connection = Connection::open_in_memory()?;
        let bridge = Self {
            path: None,
            connection: Mutex::new(connection),
            registry,
        };
        bridge.init()?;
        Ok(bridge)
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn upsert_json(&self, table: &str, doc: Value) -> Result<JsonKey, BridgeError> {
        let schema = self.registry.table(table)?;
        let doc = match doc {
            Value::Object(map) => map,
            _ => return Err(BridgeError::DocumentMustBeObject),
        };

        let key = schema.extract_key_from_doc(&doc)?;
        let known_keys = schema.known_json_keys();
        let mut ext_map = Map::new();
        for (key, value) in &doc {
            if !known_keys.contains(key) {
                ext_map.insert(key.clone(), value.clone());
            }
        }

        let mut columns = Vec::new();
        let mut values = Vec::new();
        for field in &schema.expanded_fields {
            columns.push(field.column_name.clone());
            let value = field.value_or_default(&doc)?;
            values.push(field.to_sql_value(&value)?);
        }
        for field in &schema.preserved_fields {
            columns.push(field.column_name.clone());
            let value = field.value_or_default(&doc)?;
            values.push(field.to_sql_value(&value)?);
        }
        if let Some(ext_field) = &schema.ext_field {
            columns.push(ext_field.column_name.clone());
            let ext_value = if ext_map.is_empty() {
                match &ext_field.default_json {
                    Some(Value::Object(default_map)) => default_map.clone(),
                    Some(other) => {
                        return Err(BridgeError::ExtFieldMustBeObject {
                            column: ext_field.column_name.clone(),
                            actual: json_type_name(other).to_string(),
                        });
                    }
                    None => Map::new(),
                }
            } else {
                ext_map
            };
            values.push(ext_field.to_sql_value(&ext_value)?);
        }

        let placeholders = (1..=columns.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>();
        let pk_columns = schema
            .primary_keys
            .iter()
            .map(|key_name| {
                schema
                    .expanded_field(key_name)
                    .map(|field| field.column_name.clone())
                    .ok_or_else(|| BridgeError::SchemaInvalid {
                        table: schema.table_name.clone(),
                        reason: format!("missing primary key field `{key_name}`"),
                    })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let update_columns = columns
            .iter()
            .filter(|column| !pk_columns.iter().any(|pk| pk == *column))
            .map(|column| format!("{column} = excluded.{column}"))
            .collect::<Vec<_>>();
        let conflict_clause = if update_columns.is_empty() {
            format!("ON CONFLICT({}) DO NOTHING", pk_columns.join(", "))
        } else {
            format!(
                "ON CONFLICT({}) DO UPDATE SET {}",
                pk_columns.join(", "),
                update_columns.join(", ")
            )
        };

        let sql = format!(
            "INSERT INTO {} ({}) VALUES ({}) {}",
            schema.table_name,
            columns.join(", "),
            placeholders.join(", "),
            conflict_clause
        );

        let connection = self.connection();
        connection.execute(&sql, params_from_iter(values.iter()))?;
        Ok(key)
    }

    pub fn get_json(&self, table: &str, key: &JsonKey) -> Result<Option<Value>, BridgeError> {
        let schema = self.registry.table(table)?.clone();
        let mut predicates = Vec::new();
        let mut params = Vec::new();
        for (index, key_name) in schema.primary_keys.iter().enumerate() {
            let field =
                schema
                    .expanded_field(key_name)
                    .ok_or_else(|| BridgeError::SchemaInvalid {
                        table: schema.table_name.clone(),
                        reason: format!("missing primary key field `{key_name}`"),
                    })?;
            let value = key
                .get(key_name)
                .ok_or_else(|| BridgeError::MissingPrimaryKeyField {
                    field: key_name.clone(),
                })?;
            predicates.push(format!("{} = ?{}", field.column_name, index + 1));
            params.push(field.to_sql_value(value)?);
        }

        let sql = format!(
            "SELECT {} FROM {} WHERE {}",
            schema.all_column_names().join(", "),
            schema.table_name,
            predicates.join(" AND ")
        );
        let connection = self.connection();
        let mut statement = connection.prepare(&sql)?;
        statement
            .query_row(params_from_iter(params.iter()), |row| {
                schema.row_to_json(row).map_err(map_bridge_error)
            })
            .optional()
            .map_err(BridgeError::from)
    }

    pub fn query_json(
        &self,
        table: &str,
        sql_tail: &str,
        params: &[Value],
    ) -> Result<Vec<Value>, BridgeError> {
        let schema = self.registry.table(table)?.clone();
        let sql_tail = sql_tail.trim();
        let sql = if sql_tail.is_empty() {
            format!(
                "SELECT {} FROM {}",
                schema.all_column_names().join(", "),
                schema.table_name
            )
        } else {
            format!(
                "SELECT {} FROM {} WHERE {}",
                schema.all_column_names().join(", "),
                schema.table_name,
                sql_tail
            )
        };

        let db_params = params
            .iter()
            .map(json_value_to_query_param)
            .collect::<Result<Vec<_>, _>>()?;
        let connection = self.connection();
        let mut statement = connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(db_params.iter()), |row| {
            schema.row_to_json(row).map_err(map_bridge_error)
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(BridgeError::from)
    }

    pub fn delete_json(&self, table: &str, key: &JsonKey) -> Result<bool, BridgeError> {
        let schema = self.registry.table(table)?;
        let mut predicates = Vec::new();
        let mut params = Vec::new();
        for (index, key_name) in schema.primary_keys.iter().enumerate() {
            let field =
                schema
                    .expanded_field(key_name)
                    .ok_or_else(|| BridgeError::SchemaInvalid {
                        table: schema.table_name.clone(),
                        reason: format!("missing primary key field `{key_name}`"),
                    })?;
            let value = key
                .get(key_name)
                .ok_or_else(|| BridgeError::MissingPrimaryKeyField {
                    field: key_name.clone(),
                })?;
            predicates.push(format!("{} = ?{}", field.column_name, index + 1));
            params.push(field.to_sql_value(value)?);
        }

        let sql = format!(
            "DELETE FROM {} WHERE {}",
            schema.table_name,
            predicates.join(" AND ")
        );
        let connection = self.connection();
        let changed = connection.execute(&sql, params_from_iter(params.iter()))?;
        Ok(changed > 0)
    }

    fn init(&self) -> Result<(), BridgeError> {
        let connection = self.connection();
        for schema in self.registry.iter() {
            ensure_table(&connection, schema)?;
            ensure_indexes(&connection, schema)?;
        }
        Ok(())
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

fn ensure_table(connection: &Connection, schema: &TableSchema) -> Result<(), BridgeError> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1",
            params![schema.table_name],
            |_| Ok(()),
        )
        .optional()?
        .is_some();

    if !exists {
        connection.execute_batch(&schema.create_table_sql()?)?;
        return Ok(());
    }

    let existing_columns = table_columns(connection, &schema.table_name)?;
    ensure_primary_key_compatibility(schema, &existing_columns)?;

    for field in &schema.expanded_fields {
        if let Some(existing) = existing_columns.get(&field.column_name) {
            ensure_column_compatibility(
                &schema.table_name,
                existing,
                &field.column_name,
                field.sql_type.as_sql(),
                field.nullable,
            )?;
            continue;
        }
        connection.execute(
            &format!(
                "ALTER TABLE {} ADD COLUMN {}",
                schema.table_name,
                field.sql_definition()?
            ),
            [],
        )?;
    }
    for field in &schema.preserved_fields {
        if let Some(existing) = existing_columns.get(&field.column_name) {
            ensure_column_compatibility(
                &schema.table_name,
                existing,
                &field.column_name,
                "TEXT",
                field.nullable,
            )?;
            continue;
        }
        connection.execute(
            &format!(
                "ALTER TABLE {} ADD COLUMN {}",
                schema.table_name,
                field.sql_definition()?
            ),
            [],
        )?;
    }
    if let Some(ext_field) = &schema.ext_field {
        if let Some(existing) = existing_columns.get(&ext_field.column_name) {
            ensure_column_compatibility(
                &schema.table_name,
                existing,
                &ext_field.column_name,
                "TEXT",
                ext_field.nullable,
            )?;
        } else {
            connection.execute(
                &format!(
                    "ALTER TABLE {} ADD COLUMN {}",
                    schema.table_name,
                    ext_field.sql_definition()?
                ),
                [],
            )?;
        }
    }

    Ok(())
}

fn ensure_indexes(connection: &Connection, schema: &TableSchema) -> Result<(), BridgeError> {
    for index in &schema.indexes {
        let keyword = if index.unique { "UNIQUE " } else { "" };
        connection.execute(
            &format!(
                "CREATE {}INDEX IF NOT EXISTS {} ON {} ({})",
                keyword,
                index.name,
                schema.table_name,
                index.columns.join(", ")
            ),
            [],
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct ExistingColumn {
    name: String,
    declared_type: String,
    not_null: bool,
    pk_position: usize,
}

impl ExistingColumn {
    fn normalized_declared_type(&self) -> String {
        self.declared_type.trim().to_ascii_uppercase()
    }

    fn effective_not_null(&self) -> bool {
        self.not_null || self.pk_position > 0
    }
}

fn table_columns(
    connection: &Connection,
    table_name: &str,
) -> Result<HashMap<String, ExistingColumn>, BridgeError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table_name})"))?;
    let rows = statement.query_map([], |row| {
        Ok(ExistingColumn {
            name: row.get(1)?,
            declared_type: row.get(2)?,
            not_null: row.get::<_, i64>(3)? != 0,
            pk_position: row.get::<_, i64>(5)? as usize,
        })
    })?;
    Ok(rows
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|column| (column.name.clone(), column))
        .collect())
}

fn ensure_primary_key_compatibility(
    schema: &TableSchema,
    existing_columns: &HashMap<String, ExistingColumn>,
) -> Result<(), BridgeError> {
    let expected_pk_columns = schema
        .primary_keys
        .iter()
        .map(|primary_key| {
            schema
                .expanded_field(primary_key)
                .map(|field| field.column_name.clone())
                .ok_or_else(|| BridgeError::SchemaInvalid {
                    table: schema.table_name.clone(),
                    reason: format!("missing primary key field `{primary_key}`"),
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut existing_pk_columns = existing_columns
        .values()
        .filter(|column| column.pk_position > 0)
        .cloned()
        .collect::<Vec<_>>();
    existing_pk_columns.sort_by_key(|column| column.pk_position);
    let existing_pk_names = existing_pk_columns
        .iter()
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();

    if existing_pk_names != expected_pk_columns {
        return Err(BridgeError::UnsupportedMigration {
            table: schema.table_name.clone(),
            reason: format!(
                "primary key shape mismatch: expected ({}) but found ({})",
                expected_pk_columns.join(", "),
                existing_pk_names.join(", ")
            ),
        });
    }

    Ok(())
}

fn ensure_column_compatibility(
    table_name: &str,
    existing: &ExistingColumn,
    expected_column_name: &str,
    expected_sql_type: &str,
    expected_nullable: bool,
) -> Result<(), BridgeError> {
    let existing_type = existing.normalized_declared_type();
    let expected_type = expected_sql_type.to_ascii_uppercase();
    if existing_type != expected_type {
        return Err(BridgeError::UnsupportedMigration {
            table: table_name.to_string(),
            reason: format!(
                "column `{expected_column_name}` type mismatch: expected {expected_type}, found {existing_type}"
            ),
        });
    }

    let expected_not_null = !expected_nullable;
    let existing_not_null = existing.effective_not_null();
    if existing_not_null != expected_not_null {
        return Err(BridgeError::UnsupportedMigration {
            table: table_name.to_string(),
            reason: format!(
                "column `{expected_column_name}` nullability mismatch: expected {}, found {}",
                if expected_not_null {
                    "NOT NULL"
                } else {
                    "NULLABLE"
                },
                if existing_not_null {
                    "NOT NULL"
                } else {
                    "NULLABLE"
                }
            ),
        });
    }

    Ok(())
}

fn json_value_to_sql_typed(
    field_name: &str,
    value: &Value,
    sql_type: SqlType,
    nullable: bool,
) -> Result<SqlValue, BridgeError> {
    if value.is_null() {
        if nullable {
            return Ok(SqlValue::Null);
        }
        return Err(BridgeError::FieldTypeMismatch {
            field: field_name.to_string(),
            expected: type_name_for_sql_type(sql_type, nullable),
            actual: "null".to_string(),
        });
    }

    match sql_type {
        SqlType::Text => match value {
            Value::String(text) => Ok(SqlValue::Text(text.clone())),
            other => Err(BridgeError::FieldTypeMismatch {
                field: field_name.to_string(),
                expected: "string".to_string(),
                actual: json_type_name(other).to_string(),
            }),
        },
        SqlType::Integer => match value {
            Value::Number(number) => json_number_to_i64(field_name, number).map(SqlValue::Integer),
            other => Err(BridgeError::FieldTypeMismatch {
                field: field_name.to_string(),
                expected: "integer".to_string(),
                actual: json_type_name(other).to_string(),
            }),
        },
        SqlType::Real => match value {
            Value::Number(number) => {
                let float_value =
                    number
                        .as_f64()
                        .ok_or_else(|| BridgeError::FieldTypeMismatch {
                            field: field_name.to_string(),
                            expected: "number".to_string(),
                            actual: number.to_string(),
                        })?;
                Ok(SqlValue::Real(float_value))
            }
            other => Err(BridgeError::FieldTypeMismatch {
                field: field_name.to_string(),
                expected: "number".to_string(),
                actual: json_type_name(other).to_string(),
            }),
        },
        SqlType::Boolean => match value {
            Value::Bool(boolean) => Ok(SqlValue::Integer(if *boolean { 1 } else { 0 })),
            other => Err(BridgeError::FieldTypeMismatch {
                field: field_name.to_string(),
                expected: "boolean".to_string(),
                actual: json_type_name(other).to_string(),
            }),
        },
    }
}

fn json_value_to_query_param(value: &Value) -> Result<SqlValue, BridgeError> {
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::Bool(boolean) => Ok(SqlValue::Integer(if *boolean { 1 } else { 0 })),
        Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                return Ok(SqlValue::Integer(integer));
            }
            if let Some(unsigned) = number.as_u64() {
                return Ok(SqlValue::Integer(i64::try_from(unsigned).map_err(
                    |_| BridgeError::NumericOverflow {
                        field: "<query_param>".to_string(),
                    },
                )?));
            }
            if let Some(real) = number.as_f64() {
                return Ok(SqlValue::Real(real));
            }
            Err(BridgeError::FieldTypeMismatch {
                field: "<query_param>".to_string(),
                expected: "number".to_string(),
                actual: number.to_string(),
            })
        }
        Value::String(text) => Ok(SqlValue::Text(text.clone())),
        Value::Array(_) | Value::Object(_) => Ok(SqlValue::Text(serde_json::to_string(value)?)),
    }
}

fn json_number_to_i64(field_name: &str, number: &Number) -> Result<i64, BridgeError> {
    if let Some(value) = number.as_i64() {
        return Ok(value);
    }
    if let Some(value) = number.as_u64() {
        return i64::try_from(value).map_err(|_| BridgeError::NumericOverflow {
            field: field_name.to_string(),
        });
    }
    Err(BridgeError::FieldTypeMismatch {
        field: field_name.to_string(),
        expected: "integer".to_string(),
        actual: number.to_string(),
    })
}

fn sql_literal_for_default(value: &Value, sql_type: SqlType) -> Result<String, BridgeError> {
    if value.is_null() {
        return Ok("NULL".to_string());
    }

    match sql_type {
        SqlType::Text => match value {
            Value::String(text) => Ok(quoted_sql_text(text)),
            other => Err(BridgeError::FieldTypeMismatch {
                field: "<default>".to_string(),
                expected: "string".to_string(),
                actual: json_type_name(other).to_string(),
            }),
        },
        SqlType::Integer => match value {
            Value::Number(number) => Ok(json_number_to_i64("<default>", number)?.to_string()),
            other => Err(BridgeError::FieldTypeMismatch {
                field: "<default>".to_string(),
                expected: "integer".to_string(),
                actual: json_type_name(other).to_string(),
            }),
        },
        SqlType::Real => match value {
            Value::Number(number) => {
                number.as_f64().map(|real| real.to_string()).ok_or_else(|| {
                    BridgeError::FieldTypeMismatch {
                        field: "<default>".to_string(),
                        expected: "number".to_string(),
                        actual: number.to_string(),
                    }
                })
            }
            other => Err(BridgeError::FieldTypeMismatch {
                field: "<default>".to_string(),
                expected: "number".to_string(),
                actual: json_type_name(other).to_string(),
            }),
        },
        SqlType::Boolean => match value {
            Value::Bool(boolean) => Ok(if *boolean { "1" } else { "0" }.to_string()),
            other => Err(BridgeError::FieldTypeMismatch {
                field: "<default>".to_string(),
                expected: "boolean".to_string(),
                actual: json_type_name(other).to_string(),
            }),
        },
    }
}

fn sql_literal_for_json(value: &Value) -> Result<String, BridgeError> {
    Ok(quoted_sql_text(&serde_json::to_string(value)?))
}

fn quoted_sql_text(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn validate_identifier(identifier: &str) -> Result<(), BridgeError> {
    let mut chars = identifier.chars();
    match chars.next() {
        Some(first) if first == '_' || first.is_ascii_alphabetic() => {}
        _ => {
            return Err(BridgeError::InvalidIdentifier {
                identifier: identifier.to_string(),
            });
        }
    }
    if chars.all(|character| character == '_' || character.is_ascii_alphanumeric()) {
        Ok(())
    } else {
        Err(BridgeError::InvalidIdentifier {
            identifier: identifier.to_string(),
        })
    }
}

fn type_name_for_sql_type(sql_type: SqlType, nullable: bool) -> String {
    let base = match sql_type {
        SqlType::Text => "string",
        SqlType::Integer => "integer",
        SqlType::Real => "number",
        SqlType::Boolean => "boolean",
    };
    if nullable {
        format!("{base} | null")
    } else {
        base.to_string()
    }
}

fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(number) if number.is_i64() || number.is_u64() => "integer",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn map_bridge_error(error: BridgeError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn task_schema() -> TableSchema {
        TableSchema::new("tasks")
            .primary_keys(&["scope_key", "id"])
            .expanded_fields(vec![
                FieldDef::text("scope_key").default_json(json!("anonymous")),
                FieldDef::text("id"),
                FieldDef::text("title"),
                FieldDef::text("status").default_json(json!("pending")),
                FieldDef::integer("created_at"),
                FieldDef::integer("updated_at"),
                FieldDef::integer("estimated_minutes").nullable(),
            ])
            .preserved_fields(vec![
                PreservedFieldDef::json("tags").default_json(json!([])),
                PreservedFieldDef::json("depends_on").default_json(json!([])),
            ])
            .ext_field(ExtFieldDef::new("_ext_json").default_json(json!({})))
            .indexes(vec![IndexDef::new(
                "idx_tasks_scope_status",
                &["scope_key", "status"],
            )])
    }

    fn bridge() -> SqliteJsonBridge {
        let mut registry = SchemaRegistry::new();
        registry.register(task_schema()).unwrap();
        SqliteJsonBridge::open_in_memory(registry).unwrap()
    }

    #[test]
    fn bridge_roundtrips_composite_key_and_ext_fields() {
        let bridge = bridge();
        let key = bridge
            .upsert_json(
                "tasks",
                json!({
                    "scope_key": "alpha",
                    "id": "task-1",
                    "title": "Prototype",
                    "status": "pending",
                    "created_at": 1000,
                    "updated_at": 1000,
                    "tags": ["bridge"],
                    "depends_on": [],
                    "custom_note": "ext"
                }),
            )
            .unwrap();

        assert_eq!(key.get("scope_key"), Some(&json!("alpha")));
        assert_eq!(key.get("id"), Some(&json!("task-1")));

        let loaded = bridge.get_json("tasks", &key).unwrap().unwrap();
        assert_eq!(loaded["title"], json!("Prototype"));
        assert_eq!(loaded["tags"], json!(["bridge"]));
        assert_eq!(loaded["custom_note"], json!("ext"));
        assert_eq!(loaded["estimated_minutes"], Value::Null);
    }

    #[test]
    fn bridge_distinguishes_missing_and_null() {
        let bridge = bridge();
        bridge
            .upsert_json(
                "tasks",
                json!({
                    "scope_key": "alpha",
                    "id": "task-2",
                    "title": "Defaults",
                    "status": "pending",
                    "created_at": 1000,
                    "updated_at": 1000,
                    "estimated_minutes": null
                }),
            )
            .unwrap();

        let loaded = bridge
            .get_json(
                "tasks",
                &Map::from_iter([
                    ("scope_key".to_string(), json!("alpha")),
                    ("id".to_string(), json!("task-2")),
                ]),
            )
            .unwrap()
            .unwrap();

        assert_eq!(loaded["estimated_minutes"], Value::Null);
        assert_eq!(loaded["tags"], json!([]));
        assert_eq!(loaded["depends_on"], json!([]));
    }

    #[test]
    fn bridge_rejects_type_mismatch() {
        let bridge = bridge();
        let error = bridge
            .upsert_json(
                "tasks",
                json!({
                    "scope_key": "alpha",
                    "id": "task-3",
                    "title": "Bad",
                    "status": "pending",
                    "created_at": "nope",
                    "updated_at": 1000
                }),
            )
            .unwrap_err();

        assert!(matches!(
            error,
            BridgeError::FieldTypeMismatch { field, .. } if field == "created_at"
        ));
    }

    #[test]
    fn bridge_query_json_supports_json_each_filters() {
        let bridge = bridge();
        bridge
            .upsert_json(
                "tasks",
                json!({
                    "scope_key": "alpha",
                    "id": "task-4",
                    "title": "Query me",
                    "status": "pending",
                    "created_at": 1000,
                    "updated_at": 1000,
                    "tags": ["urgent", "bridge"],
                    "depends_on": [{"task_id": "task-0", "type": "soft"}]
                }),
            )
            .unwrap();
        bridge
            .upsert_json(
                "tasks",
                json!({
                    "scope_key": "alpha",
                    "id": "task-5",
                    "title": "Skip me",
                    "status": "pending",
                    "created_at": 1001,
                    "updated_at": 1001,
                    "tags": ["normal"],
                    "depends_on": []
                }),
            )
            .unwrap();

        let rows = bridge
            .query_json(
                "tasks",
                "scope_key = ?1 AND EXISTS (
                    SELECT 1
                    FROM json_each(tasks.tags_json, '$') je
                    WHERE je.value = ?2
                )
                ORDER BY created_at DESC, id DESC",
                &[json!("alpha"), json!("urgent")],
            )
            .unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], json!("task-4"));
    }

    #[test]
    fn bridge_requires_ext_field_in_schema() {
        let schema = TableSchema::new("no_ext")
            .primary_keys(&["id"])
            .expanded_fields(vec![FieldDef::text("id")]);
        let mut registry = SchemaRegistry::new();
        let error = registry.register(schema).unwrap_err();

        assert!(matches!(
            error,
            BridgeError::SchemaInvalid { table, reason }
                if table == "no_ext" && reason.contains("ext_field")
        ));
    }

    #[test]
    fn bridge_rejects_incompatible_existing_column_type() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("bridge.sqlite");
        {
            let connection = Connection::open(&sqlite_path).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE tasks (
                        scope_key TEXT NOT NULL,
                        id TEXT NOT NULL,
                        title TEXT NOT NULL,
                        status TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY (scope_key, id)
                    );",
                )
                .unwrap();
        }

        let mut registry = SchemaRegistry::new();
        registry.register(task_schema()).unwrap();
        let error = SqliteJsonBridge::open(&sqlite_path, registry).unwrap_err();

        assert!(matches!(
            error,
            BridgeError::UnsupportedMigration { table, reason }
                if table == "tasks" && reason.contains("created_at")
        ));
    }

    #[test]
    fn bridge_rejects_incompatible_existing_primary_key_shape() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("bridge.sqlite");
        {
            let connection = Connection::open(&sqlite_path).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE tasks (
                        scope_key TEXT NOT NULL,
                        id TEXT NOT NULL PRIMARY KEY,
                        title TEXT NOT NULL,
                        status TEXT NOT NULL,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    );",
                )
                .unwrap();
        }

        let mut registry = SchemaRegistry::new();
        registry.register(task_schema()).unwrap();
        let error = SqliteJsonBridge::open(&sqlite_path, registry).unwrap_err();

        assert!(matches!(
            error,
            BridgeError::UnsupportedMigration { table, reason }
                if table == "tasks" && reason.contains("primary key shape mismatch")
        ));
    }

    #[test]
    fn bridge_auto_adds_missing_columns_for_existing_table() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("bridge.sqlite");
        {
            let connection = Connection::open(&sqlite_path).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE tasks (
                        scope_key TEXT NOT NULL,
                        id TEXT NOT NULL,
                        title TEXT NOT NULL,
                        status TEXT NOT NULL,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY (scope_key, id)
                    );",
                )
                .unwrap();
        }

        let mut registry = SchemaRegistry::new();
        registry.register(task_schema()).unwrap();
        let bridge = SqliteJsonBridge::open(&sqlite_path, registry).unwrap();

        let columns = table_columns(&bridge.connection(), "tasks").unwrap();
        assert!(columns.contains_key("estimated_minutes"));
        assert!(columns.contains_key("tags_json"));
        assert!(columns.contains_key("depends_on_json"));
        assert!(columns.contains_key("_ext_json"));
    }

    #[test]
    fn bridge_supports_real_boolean_and_custom_column_variants() {
        let mut registry = SchemaRegistry::new();
        registry
            .register(
                TableSchema::new("metrics")
                    .primary_keys(&["id"])
                    .expanded_fields(vec![
                        FieldDef::text("id"),
                        FieldDef::real("score").column_name("score_value"),
                        FieldDef::boolean("archived").default_json(json!(false)),
                    ])
                    .preserved_fields(vec![
                        PreservedFieldDef::json("meta")
                            .column_name("meta_blob")
                            .nullable(),
                    ])
                    .ext_field(
                        ExtFieldDef::new("_ext_json")
                            .nullable()
                            .default_json(json!({})),
                    )
                    .indexes(vec![
                        IndexDef::new("idx_metrics_id_unique", &["id"]).unique(),
                    ]),
            )
            .unwrap();
        let bridge = SqliteJsonBridge::open_in_memory(registry).unwrap();

        bridge
            .upsert_json(
                "metrics",
                json!({
                    "id": "metric-1",
                    "score": 9.5,
                    "archived": true,
                    "meta": null
                }),
            )
            .unwrap();

        let loaded = bridge
            .get_json(
                "metrics",
                &Map::from_iter([("id".to_string(), json!("metric-1"))]),
            )
            .unwrap()
            .unwrap();

        assert_eq!(loaded["score"], json!(9.5));
        assert_eq!(loaded["archived"], json!(true));
        assert_eq!(loaded["meta"], Value::Null);
    }

    #[test]
    fn bridge_file_backed_store_survives_reopen() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("bridge.sqlite");

        let mut registry = SchemaRegistry::new();
        registry.register(task_schema()).unwrap();
        let bridge = SqliteJsonBridge::open(&sqlite_path, registry.clone()).unwrap();
        bridge
            .upsert_json(
                "tasks",
                json!({
                    "scope_key": "alpha",
                    "id": "task-6",
                    "title": "Persist",
                    "status": "pending",
                    "created_at": 1000,
                    "updated_at": 1000,
                    "tags": ["persisted"],
                    "depends_on": []
                }),
            )
            .unwrap();
        drop(bridge);

        let reopened = SqliteJsonBridge::open(&sqlite_path, registry).unwrap();
        let loaded = reopened
            .get_json(
                "tasks",
                &Map::from_iter([
                    ("scope_key".to_string(), json!("alpha")),
                    ("id".to_string(), json!("task-6")),
                ]),
            )
            .unwrap()
            .unwrap();
        assert_eq!(loaded["tags"], json!(["persisted"]));
    }

    #[test]
    fn bridge_delete_removes_row() {
        let bridge = bridge();
        let key = bridge
            .upsert_json(
                "tasks",
                json!({
                    "scope_key": "alpha",
                    "id": "task-7",
                    "title": "Delete me",
                    "status": "pending",
                    "created_at": 1000,
                    "updated_at": 1000,
                    "tags": [],
                    "depends_on": []
                }),
            )
            .unwrap();

        assert!(bridge.delete_json("tasks", &key).unwrap());
        assert!(bridge.get_json("tasks", &key).unwrap().is_none());
    }
}
