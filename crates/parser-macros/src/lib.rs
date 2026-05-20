use proc_macro::TokenStream;
use syn::parse_macro_input;

mod emit;
mod input;
mod validate;

#[proc_macro_attribute]
pub fn document_nodes(attr: TokenStream, item: TokenStream) -> TokenStream {
    if !attr.is_empty() {
        return syn::Error::new(
            proc_macro2::Span::call_site(),
            "document_nodes does not accept arguments",
        )
        .to_compile_error()
        .into();
    }

    let item = parse_macro_input!(item as syn::ItemEnum);
    match input::parse(item).and_then(validate::validate).map(emit::emit) {
        Ok(tokens) => tokens.into(),
        Err(err) => err.to_compile_error().into(),
    }
}
