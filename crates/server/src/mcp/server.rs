//! MCP server handler and advertised protocol capabilities.

use rmcp::handler::server::router::prompt::PromptRouter;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::model::{
    GetPromptRequestParams, GetPromptResult, Implementation, ListPromptsResult,
    ListResourceTemplatesResult, ListResourcesResult, PaginatedRequestParams,
    ReadResourceRequestParams, ReadResourceResult, ServerCapabilities, ServerInfo,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{ErrorData, ServerHandler, prompt_handler, tool_handler};

use crate::VERSION;
use crate::mcp::resources;
use crate::state::AppState;

const INSTRUCTIONS: &str = include_str!("assets/instructions.md");

/// Curated MCP handler backed by Canary application state.
///
/// A fresh handler is created for each logical Streamable HTTP session. Cloning
/// [`AppState`] is cheap because the state owns its services through shared
/// handles.
#[derive(Clone)]
pub struct Mcp {
    _state: AppState,
    tools: ToolRouter<Self>,
    prompts: PromptRouter<Self>,
}

impl Mcp {
    /// Creates an MCP handler for one logical client session.
    #[must_use]
    #[inline(always)]
    pub fn new(state: AppState) -> Self {
        Self { _state: state, tools: Self::tool_router(), prompts: Self::prompt_router() }
    }
}

#[tool_handler(router = self.tools)]
#[prompt_handler(router = self.prompts)]
impl ServerHandler for Mcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_prompts()
                .enable_resources()
                .enable_tools()
                .build(),
        )
        .with_server_info(
            Implementation::new("canary", VERSION.package())
                .with_title("Canary Knowledge Server")
                .with_description("Curated private-knowledge retrieval and ingestion for agents"),
        )
        .with_instructions(INSTRUCTIONS)
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        Ok(resources::list())
    }

    async fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, ErrorData> {
        Ok(resources::templates())
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResult, ErrorData> {
        resources::read(&request.uri)
    }
}
